import fs from 'fs';
import path from 'path';
import { loadAgentConfig } from './agent-config.js';

const WORKSPACE_GROUP = '/workspace/group';
const OUTPUT_DIR = path.join(WORKSPACE_GROUP, 'voice_output');

export interface TtsOptions {
  voice?: string;
  language?: string;
  speed?: number;
}

export async function synthesizeSpeech(text: string, options?: TtsOptions): Promise<string> {
  const config = loadAgentConfig();
  const ttsConfig = config.agent.tts;

  if (!ttsConfig.enabled) {
    throw new Error('TTS is disabled in agent configuration');
  }

  if (!text || !text.trim()) {
    throw new Error('Text is required for TTS');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  if (ttsConfig.provider === 'openai') {
    return synthesizeOpenAI(text, ttsConfig);
  }

  return synthesizeEdgeTTS(text, ttsConfig, options);
}

async function synthesizeEdgeTTS(text: string, ttsConfig: ReturnType<typeof loadAgentConfig>['agent']['tts'], options?: TtsOptions): Promise<string> {
  const voice = options?.voice || ttsConfig.defaultVoice;
  const lang = options?.language || 'en-US';
  const rate = options?.speed && options.speed !== 1.0
    ? `${options.speed > 1 ? '+' : ''}${Math.round((options.speed - 1) * 100)}%`
    : 'default';

  const { EdgeTTS } = await import('node-edge-tts');
  const tts = new EdgeTTS({
    voice,
    lang,
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    rate,
    timeout: 15_000,
  });

  const ts = Date.now();
  const mp3Path = path.join(OUTPUT_DIR, `tts_${ts}.mp3`);
  const oggPath = path.join(OUTPUT_DIR, `tts_${ts}.ogg`);

  await tts.ttsPromise(text.slice(0, 4096), mp3Path);

  // Convert MP3 → OGG Opus for Telegram voice notes
  const { execFileSync } = await import('child_process');
  execFileSync('ffmpeg', [
    '-y', '-i', mp3Path,
    '-c:a', 'libopus', '-b:a', '48k',
    oggPath
  ], { timeout: 15_000, stdio: 'pipe' });

  // Clean up temp MP3
  try { fs.unlinkSync(mp3Path); } catch { /* ignore */ }

  return oggPath;
}

async function synthesizeOpenAI(text: string, ttsConfig: ReturnType<typeof loadAgentConfig>['agent']['tts']): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('No API key for OpenAI TTS');

  const baseUrl = process.env.OPENAI_API_KEY
    ? 'https://api.openai.com/v1/audio/speech'
    : 'https://openrouter.ai/api/v1/audio/speech';

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ttsConfig.openaiModel || 'tts-1',
      input: text.slice(0, 4096),
      voice: ttsConfig.openaiVoice || 'alloy',
      response_format: 'opus',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI TTS failed (${response.status}): ${errText.slice(0, 300)}`);
  }

  const ts = Date.now();
  const oggPath = path.join(OUTPUT_DIR, `tts_${ts}.ogg`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(oggPath, buffer);
  return oggPath;
}
