import { buildAgentContext, AgentContext } from './agent-context.js';
import { runContainerAgent, writeTasksSnapshot, writeGroupsSnapshot } from './container-runner.js';
import { getAllTasks, setGroupSession, logToolCalls } from './db.js';
import { MAIN_GROUP_FOLDER } from './config.js';
import { runWithAgentSemaphore } from './agent-semaphore.js';
import { withGroupLock } from './locks.js';
import { getModelPricing } from './model-registry.js';
import { computeCostUSD } from './cost.js';
import { writeTrace } from './trace-writer.js';
import { recordLatency, recordTokenUsage, recordCost, recordMemoryRecall, recordMemoryUpsert, recordMemoryExtract, recordToolCall, recordError } from './metrics.js';
import type { ContainerOutput } from './container-protocol.js';
import type { RegisteredGroup } from './types.js';

export type TraceBase = {
  trace_id: string;
  timestamp: string;
  created_at: number;
  chat_id: string;
  group_folder: string;
  user_id?: string;
  input_text: string;
  source: string;
};

export class AgentExecutionError extends Error {
  context: AgentContext;
  constructor(message: string, context: AgentContext) {
    super(message);
    this.context = context;
  }
}


export function createTraceBase(params: {
  chatId: string;
  groupFolder: string;
  userId?: string | null;
  inputText: string;
  source: string;
}): TraceBase {
  return {
    trace_id: `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    created_at: Date.now(),
    chat_id: params.chatId,
    group_folder: params.groupFolder,
    user_id: params.userId ?? undefined,
    input_text: params.inputText,
    source: params.source
  };
}

function buildTaskSnapshot() {
  const tasks = getAllTasks();
  return tasks.map(t => ({
    id: t.id,
    groupFolder: t.group_folder,
    prompt: t.prompt,
    schedule_type: t.schedule_type,
    schedule_value: t.schedule_value,
    status: t.status,
    next_run: t.next_run,
    state_json: t.state_json ?? null,
    retry_count: t.retry_count ?? 0,
    last_error: t.last_error ?? null
  }));
}

export async function executeAgentRun(params: {
  group: RegisteredGroup;
  prompt: string;
  chatJid: string;
  userId?: string | null;
  userName?: string;
  recallQuery: string;
  recallMaxResults: number;
  recallMaxTokens: number;
  toolDeny?: string[];
  sessionId?: string;
  persistSession?: boolean;
  onSessionUpdate?: (sessionId: string) => void;
  useGroupLock?: boolean;
  abortSignal?: AbortSignal;
  isScheduledTask?: boolean;
  isBackgroundTask?: boolean;
  taskId?: string;
  streaming?: {
    enabled: boolean;
    draftId: number;
    minIntervalMs?: number;
    minChars?: number;
  };
  availableGroups?: Array<{ jid: string; name: string; lastActivity: string; isRegistered: boolean }>;
}): Promise<{ output: ContainerOutput; context: AgentContext }> {
  const group = params.group;
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const persistSession = params.persistSession !== false;
  const useGroupLock = params.useGroupLock !== false;

  writeTasksSnapshot(group.folder, isMain, buildTaskSnapshot());
  if (isMain && params.availableGroups) {
    writeGroupsSnapshot(group.folder, isMain, params.availableGroups);
  }

  const context = await buildAgentContext({
    groupFolder: group.folder,
    userId: params.userId ?? null,
    recallQuery: params.recallQuery,
    recallMaxResults: params.recallMaxResults,
    recallMaxTokens: params.recallMaxTokens,
    toolDeny: params.toolDeny
  });

  const runContainer = () => runContainerAgent(group, {
    prompt: params.prompt,
    sessionId: params.sessionId,
    groupFolder: group.folder,
    chatJid: params.chatJid,
    isMain,
    isScheduledTask: params.isScheduledTask,
    isBackgroundTask: params.isBackgroundTask,
    taskId: params.taskId,
    userId: params.userId ?? undefined,
    userName: params.userName,
    memoryRecall: context.memoryRecall,
    userProfile: context.userProfile,
    memoryStats: context.memoryStats,
    tokenEstimate: context.tokenEstimate,
    toolReliability: context.toolReliability,
    behaviorConfig: context.behaviorConfig as Record<string, unknown>,
    toolPolicy: context.toolPolicy as Record<string, unknown>,
    modelOverride: context.resolvedModel.model,
    modelContextTokens: context.resolvedModel.override?.context_window,
    modelMaxOutputTokens: context.resolvedModel.override?.max_output_tokens,
    modelTemperature: context.resolvedModel.override?.temperature,
    streaming: params.streaming
  }, { abortSignal: params.abortSignal });

  let output: ContainerOutput;
  try {
    output = await runWithAgentSemaphore(() =>
      useGroupLock
        ? withGroupLock(group.folder, () => runContainer())
        : runContainer()
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentExecutionError(message, context);
  }

  if (output.newSessionId && persistSession) {
    params.onSessionUpdate?.(output.newSessionId);
    setGroupSession(group.folder, output.newSessionId);
  }

  return { output, context };
}

export function recordAgentTelemetry(params: {
  traceBase: TraceBase;
  output: ContainerOutput | null;
  context: AgentContext;
  metricsSource?: 'telegram' | 'scheduler';
  toolAuditSource: 'message' | 'background' | 'scheduler' | 'heartbeat';
  errorMessage?: string;
  errorType?: string;
}): void {
  const { traceBase, output, context } = params;
  const pricing = output?.model
    ? getModelPricing(context.modelRegistry, output.model)
    : context.modelPricing;
  const cost = computeCostUSD(output?.tokens_prompt, output?.tokens_completion, pricing);

  writeTrace({
    ...traceBase,
    output_text: output?.result ?? null,
    model_id: output?.model || 'unknown',
    prompt_pack_versions: output?.prompt_pack_versions,
    memory_summary: output?.memory_summary,
    memory_facts: output?.memory_facts,
    memory_recall: context.memoryRecall,
    tool_calls: output?.tool_calls,
    latency_ms: output?.latency_ms,
    tokens_prompt: output?.tokens_prompt,
    tokens_completion: output?.tokens_completion,
    cost_prompt_usd: cost?.prompt,
    cost_completion_usd: cost?.completion,
    cost_total_usd: cost?.total,
    memory_recall_count: output?.memory_recall_count,
    session_recall_count: output?.session_recall_count,
    memory_items_upserted: output?.memory_items_upserted,
    memory_items_extracted: output?.memory_items_extracted,
    error_code: params.errorMessage || (output?.status === 'error' ? output?.error : undefined)
  });

  if (params.errorMessage || output?.status === 'error') {
    if (params.errorType) {
      recordError(params.errorType);
    }
  }

  if (params.metricsSource) {
    if (output?.latency_ms) {
      recordLatency(output.latency_ms);
    }
    if (Number.isFinite(output?.tokens_prompt) || Number.isFinite(output?.tokens_completion)) {
      const modelId = output?.model || context.resolvedModel.model;
      recordTokenUsage(modelId, params.metricsSource, output?.tokens_prompt || 0, output?.tokens_completion || 0);
      if (cost) {
        recordCost(modelId, params.metricsSource, cost.total);
      }
    }
    if (Number.isFinite(output?.memory_recall_count)) {
      recordMemoryRecall(params.metricsSource, output?.memory_recall_count || 0);
    }
    if (Number.isFinite(output?.memory_items_upserted)) {
      recordMemoryUpsert(params.metricsSource, output?.memory_items_upserted || 0);
    }
    if (Number.isFinite(output?.memory_items_extracted)) {
      recordMemoryExtract(params.metricsSource, output?.memory_items_extracted || 0);
    }
  }

  if (output?.tool_calls && output.tool_calls.length > 0) {
    logToolCalls({
      traceId: traceBase.trace_id,
      chatJid: traceBase.chat_id,
      groupFolder: traceBase.group_folder,
      userId: traceBase.user_id ?? null,
      toolCalls: output.tool_calls,
      source: params.toolAuditSource
    });
    for (const call of output.tool_calls) {
      recordToolCall(call.name, call.ok);
    }
  }
}
