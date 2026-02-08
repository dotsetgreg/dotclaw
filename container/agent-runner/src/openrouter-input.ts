import fs from 'fs';
import path from 'path';

import type { ContainerInput } from './container-protocol.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB per image
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB total across all images
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export interface OpenRouterInputTextPart {
  type: 'input_text';
  text: string;
}

export interface OpenRouterInputImagePart {
  type: 'input_image';
  detail: 'auto';
  imageUrl: string;
}

export type OpenRouterUserContentPart = OpenRouterInputTextPart | OpenRouterInputImagePart;

export interface OpenRouterInputMessage {
  role: 'user' | 'assistant';
  content: string | OpenRouterUserContentPart[];
}

export interface OpenRouterFunctionCallItem {
  type: 'function_call';
  id: string;
  callId: string;
  name: string;
  arguments: string;
}

export interface OpenRouterFunctionCallOutputItem {
  type: 'function_call_output';
  callId: string;
  output: string;
}

export type OpenRouterConversationItem =
  | string
  | OpenRouterInputMessage
  | OpenRouterFunctionCallItem
  | OpenRouterFunctionCallOutputItem;

export interface SanitizedConversationInput {
  items: OpenRouterConversationItem[];
  rewrittenCount: number;
  droppedCount: number;
}

type UnknownRecord = Record<string, unknown>;

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function inferImageMimeFromName(fileName?: string): string | null {
  if (!fileName || typeof fileName !== 'string') return null;
  const extension = path.extname(fileName).toLowerCase();
  if (!extension) return null;
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.webp') return 'image/webp';
  return null;
}

function normalizeMimeType(input: unknown, fallbackName?: string): string | null {
  const fromInput = typeof input === 'string'
    ? input.toLowerCase().split(';')[0].trim()
    : '';
  const candidate = fromInput || inferImageMimeFromName(fallbackName);
  if (!candidate || !IMAGE_MIME_TYPES.has(candidate)) return null;
  return candidate;
}

function jsonStringifySafe(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized : String(value);
  } catch {
    return String(value);
  }
}

function collectTextField(record: Record<string, unknown>): string | null {
  if (typeof record.text === 'string' && record.text.trim()) return record.text;
  if (typeof record.content === 'string' && record.content.trim()) return record.content;
  if (typeof record.output === 'string' && record.output.trim()) return record.output;
  if (typeof record.refusal === 'string' && record.refusal.trim()) return record.refusal;
  if (typeof record.input_text === 'string' && record.input_text.trim()) return record.input_text;
  return null;
}

function collectTextFragments(value: unknown, fragments: string[], depth = 0): void {
  if (depth > 8 || value == null) return;

  if (typeof value === 'string') {
    if (value.trim()) fragments.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFragments(item, fragments, depth + 1);
    }
    return;
  }

  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const textField = collectTextField(record);
  if (textField && textField.trim()) {
    fragments.push(textField);
  }
  if (Array.isArray(record.content)) {
    collectTextFragments(record.content, fragments, depth + 1);
  }
  if (Array.isArray(record.parts)) {
    collectTextFragments(record.parts, fragments, depth + 1);
  }
  if (Array.isArray(record.items)) {
    collectTextFragments(record.items, fragments, depth + 1);
  }
}

export function coerceInputContentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';

  if (Array.isArray(content)) {
    const parts: string[] = [];
    collectTextFragments(content, parts);
    if (parts.length > 0) return parts.join('\n');
    return jsonStringifySafe(content);
  }

  if (typeof content === 'object') {
    const parts: string[] = [];
    collectTextFragments(content, parts);
    if (parts.length > 0) return parts.join('\n');
    return jsonStringifySafe(content);
  }

  return String(content);
}

export function messagesToOpenRouterInput(
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>
): OpenRouterInputMessage[] {
  return messages.map(message => ({
    role: message.role,
    content: coerceInputContentToText(message.content)
  }));
}

function normalizeImageUrl(record: UnknownRecord): string | null {
  const direct = asNonEmptyString(record.imageUrl)
    || asNonEmptyString(record.url)
    || asNonEmptyString(record.image_url);
  if (direct) return direct;

  const nested = record.image_url;
  if (nested && typeof nested === 'object') {
    const nestedRecord = nested as UnknownRecord;
    const nestedUrl = asNonEmptyString(nestedRecord.url)
      || asNonEmptyString(nestedRecord.imageUrl);
    if (nestedUrl) return nestedUrl;
  }
  return null;
}

function normalizeInputImagePart(record: UnknownRecord): OpenRouterInputImagePart | null {
  const imageUrl = normalizeImageUrl(record);
  if (!imageUrl) return null;
  return {
    type: 'input_image',
    detail: 'auto',
    imageUrl
  };
}

function collectUserContentParts(content: unknown, parts: OpenRouterUserContentPart[], depth = 0): void {
  if (depth > 8 || content == null) return;

  if (Array.isArray(content)) {
    for (const item of content) {
      collectUserContentParts(item, parts, depth + 1);
    }
    return;
  }

  if (typeof content === 'string') {
    if (content.trim()) {
      parts.push({ type: 'input_text', text: content });
    }
    return;
  }

  if (typeof content !== 'object') {
    const primitive = String(content);
    if (primitive.trim()) {
      parts.push({ type: 'input_text', text: primitive });
    }
    return;
  }

  const record = content as UnknownRecord;
  const type = asNonEmptyString(record.type);
  const imagePart = normalizeInputImagePart(record);
  if (type === 'input_image' || type === 'image_url') {
    if (imagePart) parts.push(imagePart);
    return;
  }

  if (imagePart && (record.imageUrl != null || record.image_url != null || record.url != null)) {
    parts.push(imagePart);
    return;
  }

  const textPart = collectTextField(record);
  if (textPart && textPart.trim()) {
    parts.push({ type: 'input_text', text: textPart });
    return;
  }

  if (Array.isArray(record.content)) {
    collectUserContentParts(record.content, parts, depth + 1);
    return;
  }
  if (Array.isArray(record.parts)) {
    collectUserContentParts(record.parts, parts, depth + 1);
    return;
  }
  if (Array.isArray(record.items)) {
    collectUserContentParts(record.items, parts, depth + 1);
  }
}

function normalizeUserContent(content: unknown): string | OpenRouterUserContentPart[] {
  const parts: OpenRouterUserContentPart[] = [];
  collectUserContentParts(content, parts);
  const hasImage = parts.some((part) => part.type === 'input_image');
  if (!hasImage) {
    return coerceInputContentToText(content);
  }

  const normalizedParts = parts.filter((part) => {
    if (part.type === 'input_text') return !!part.text.trim();
    return !!part.imageUrl.trim();
  });
  const hasText = normalizedParts.some((part) => part.type === 'input_text');
  if (!hasText) {
    let fallbackText = coerceInputContentToText(content).trim();
    if (!fallbackText || fallbackText.length > 300 || fallbackText.startsWith('{') || fallbackText.startsWith('[')) {
      fallbackText = '[Image attachment]';
    }
    normalizedParts.unshift({ type: 'input_text', text: fallbackText });
  }
  return normalizedParts;
}

function normalizeRoleMessage(record: UnknownRecord): OpenRouterInputMessage | null {
  const role = record.role === 'user' || record.role === 'assistant'
    ? record.role
    : null;
  if (!role) return null;

  if (role === 'assistant') {
    return {
      role,
      content: coerceInputContentToText(record.content)
    };
  }

  return {
    role,
    content: normalizeUserContent(record.content)
  };
}

function normalizeFunctionCall(record: UnknownRecord): OpenRouterFunctionCallItem | null {
  const callId = asNonEmptyString(record.callId) || asNonEmptyString(record.id);
  const name = asNonEmptyString(record.name);
  if (!callId || !name) return null;

  const rawArguments = record.arguments;
  let argumentsText = '{}';
  if (typeof rawArguments === 'string') {
    argumentsText = rawArguments.trim() ? rawArguments : '{}';
  } else if (rawArguments != null) {
    argumentsText = jsonStringifySafe(rawArguments);
  }

  return {
    type: 'function_call',
    id: asNonEmptyString(record.id) || callId,
    callId,
    name,
    arguments: argumentsText
  };
}

function normalizeFunctionCallOutput(record: UnknownRecord): OpenRouterFunctionCallOutputItem | null {
  const callId = asNonEmptyString(record.callId);
  if (!callId) return null;
  const rawOutput = record.output;
  const output = typeof rawOutput === 'string'
    ? rawOutput
    : (rawOutput == null ? '' : jsonStringifySafe(rawOutput));
  return {
    type: 'function_call_output',
    callId,
    output
  };
}

function normalizeConversationItem(
  item: unknown
): { item: OpenRouterConversationItem; rewritten: boolean } | null {
  if (typeof item === 'string') {
    return { item, rewritten: false };
  }

  if (Array.isArray(item)) {
    const text = coerceInputContentToText(item);
    if (!text.trim()) return null;
    return { item: { role: 'user', content: text }, rewritten: true };
  }

  if (!item || typeof item !== 'object') {
    const text = String(item ?? '');
    if (!text.trim()) return null;
    return { item: { role: 'user', content: text }, rewritten: true };
  }

  const record = item as UnknownRecord;
  const type = asNonEmptyString(record.type);
  if (type === 'function_call') {
    const normalizedCall = normalizeFunctionCall(record);
    if (!normalizedCall) return null;
    return { item: normalizedCall, rewritten: true };
  }
  if (type === 'function_call_output') {
    const normalizedOutput = normalizeFunctionCallOutput(record);
    if (!normalizedOutput) return null;
    return { item: normalizedOutput, rewritten: true };
  }

  const roleMessage = normalizeRoleMessage(record);
  if (roleMessage) {
    const rewritten = typeof record.content !== 'string' || record.role !== roleMessage.role;
    return { item: roleMessage, rewritten };
  }

  const fallback = coerceInputContentToText(record).trim();
  if (!fallback) return null;
  return {
    item: { role: 'user', content: fallback },
    rewritten: true
  };
}

export function sanitizeConversationInputForResponses(input: unknown[]): SanitizedConversationInput {
  const items: OpenRouterConversationItem[] = [];
  let rewrittenCount = 0;
  let droppedCount = 0;

  for (const item of input) {
    const normalized = normalizeConversationItem(item);
    if (!normalized) {
      droppedCount += 1;
      continue;
    }
    if (normalized.rewritten) rewrittenCount += 1;
    items.push(normalized.item);
  }

  return {
    items,
    rewrittenCount,
    droppedCount
  };
}

export function loadImageAttachmentsForInput(
  attachments?: ContainerInput['attachments'],
  options?: { log?: (message: string) => void }
): OpenRouterInputImagePart[] {
  if (!Array.isArray(attachments) || attachments.length === 0) return [];

  const log = options?.log;
  const images: OpenRouterInputImagePart[] = [];
  let totalBytes = 0;

  for (const attachment of attachments) {
    if (!attachment || attachment.type !== 'photo' || typeof attachment.path !== 'string' || !attachment.path) {
      continue;
    }

    const mime = normalizeMimeType(attachment.mime_type, attachment.file_name);
    if (!mime) continue;

    try {
      const stat = fs.statSync(attachment.path);
      if (stat.size > MAX_IMAGE_BYTES) {
        log?.(`Skipping image ${attachment.path}: ${stat.size} bytes exceeds ${MAX_IMAGE_BYTES}`);
        continue;
      }
      if (totalBytes + stat.size > MAX_TOTAL_IMAGE_BYTES) {
        log?.(`Skipping image ${attachment.path}: cumulative size would exceed ${MAX_TOTAL_IMAGE_BYTES}`);
        break;
      }

      const data = fs.readFileSync(attachment.path);
      totalBytes += data.length;
      images.push({
        type: 'input_image',
        detail: 'auto',
        imageUrl: `data:${mime};base64,${data.toString('base64')}`
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log?.(`Failed to load image ${attachment.path}: ${detail}`);
    }
  }

  return images;
}

export function injectImagesIntoContextInput(
  contextInput: OpenRouterInputMessage[],
  imageParts: OpenRouterInputImagePart[]
): void {
  if (!Array.isArray(contextInput) || contextInput.length === 0 || imageParts.length === 0) return;
  const lastMessage = contextInput[contextInput.length - 1];
  if (!lastMessage || lastMessage.role !== 'user') return;

  lastMessage.content = [
    {
      type: 'input_text',
      text: coerceInputContentToText(lastMessage.content)
    },
    ...imageParts
  ];
}
