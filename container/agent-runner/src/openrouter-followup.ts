type RawRecord = Record<string, unknown>;

export type ExtractedFunctionCall = {
  id: string;
  itemId?: string;
  name: string;
  arguments: unknown;
  argumentsText: string;
};

export type ReplayFunctionCallItem = {
  type: 'function_call';
  id: string;
  callId: string;
  name: string;
  arguments: string;
};

function normalizeCallId(record: RawRecord): { callId?: string; itemId?: string } {
  const callId = typeof record.callId === 'string' && record.callId.trim()
    ? record.callId.trim()
    : (typeof record.id === 'string' && record.id.trim() ? record.id.trim() : undefined);
  const itemId = typeof record.id === 'string' && record.id.trim()
    ? record.id.trim()
    : undefined;
  return { callId, itemId };
}

function normalizeArguments(raw: unknown): { arguments: unknown; argumentsText: string } {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { arguments: {}, argumentsText: '{}' };
    try {
      return { arguments: JSON.parse(trimmed), argumentsText: trimmed };
    } catch {
      return { arguments: raw, argumentsText: raw };
    }
  }
  if (raw == null) return { arguments: {}, argumentsText: '{}' };
  try {
    const serialized = JSON.stringify(raw);
    if (typeof serialized === 'string') {
      return { arguments: raw, argumentsText: serialized };
    }
  } catch {
    // fall through
  }
  return { arguments: raw, argumentsText: String(raw) };
}

function extractFromOutput(output: unknown[]): ExtractedFunctionCall[] {
  const calls: ExtractedFunctionCall[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const record = item as RawRecord;
    if (record.type !== 'function_call') continue;
    const { callId, itemId } = normalizeCallId(record);
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!callId || !name) continue;
    const normalizedArguments = normalizeArguments(record.arguments);
    calls.push({
      id: callId,
      itemId,
      name,
      arguments: normalizedArguments.arguments,
      argumentsText: normalizedArguments.argumentsText
    });
  }
  return calls;
}

export function extractFunctionCallsForReplay(response: unknown): ExtractedFunctionCall[] {
  if (!response || typeof response !== 'object') return [];
  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) return [];
  return extractFromOutput(output);
}

export function toReplayFunctionCallItems(calls: ExtractedFunctionCall[]): ReplayFunctionCallItem[] {
  return calls.map((call) => ({
    type: 'function_call',
    id: call.itemId || call.id,
    callId: call.id,
    name: call.name,
    arguments: call.argumentsText || '{}'
  }));
}
