import fs from 'fs';
import path from 'path';
import { CronExpressionParser } from 'cron-parser';
import { getDueTasks, updateTaskAfterRun, logTaskRun, getTaskById, updateTask } from './db.js';
import { recordTaskRun, recordError, recordMessage } from './metrics.js';
import { ScheduledTask, RegisteredGroup } from './types.js';
import { GROUPS_DIR, SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { createTraceBase, executeAgentRun, recordAgentTelemetry, AgentExecutionError } from './agent-execution.js';
import { writeTrace } from './trace-writer.js';
import type { AgentContext } from './agent-context.js';
import type { ContainerOutput } from './container-protocol.js';
import { logger } from './logger.js';

const runtime = loadRuntimeConfig();

const TASK_MAX_RETRIES = runtime.host.scheduler.taskMaxRetries;
const TASK_RETRY_BASE_MS = runtime.host.scheduler.taskRetryBaseMs;
const TASK_RETRY_MAX_MS = runtime.host.scheduler.taskRetryMaxMs;

export interface SchedulerDependencies {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  getSessions: () => Record<string, string>;
  setSession: (groupFolder: string, sessionId: string) => void;
}

async function runTask(task: ScheduledTask, deps: SchedulerDependencies): Promise<void> {
  const startTime = Date.now();
  const groupDir = path.join(GROUPS_DIR, task.group_folder);
  fs.mkdirSync(groupDir, { recursive: true });

  logger.info({ taskId: task.id, group: task.group_folder }, 'Running scheduled task');
  recordMessage('scheduler');

  const groups = deps.registeredGroups();
  const group = Object.values(groups).find(g => g.folder === task.group_folder);

  if (!group) {
    logger.error({ taskId: task.id, groupFolder: task.group_folder }, 'Group not found for task');
    recordError('scheduler');
    logTaskRun({
      task_id: task.id,
      run_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'error',
      result: null,
      error: `Group not found: ${task.group_folder}`
    });
    recordTaskRun('error');
    return;
  }

  let result: string | null = null;
  let error: string | null = null;
  let output: ContainerOutput | null = null;
  let context: AgentContext | null = null;

  const sessions = deps.getSessions();
  const sessionId = task.context_mode === 'group' ? sessions[task.group_folder] : undefined;

  const stateBlock = task.state_json ? `[TASK STATE]
${task.state_json}
` : '';
  const taskPrompt = stateBlock ? `${stateBlock}
${task.prompt}` : task.prompt;

  const traceBase = createTraceBase({
    chatId: task.chat_jid,
    groupFolder: task.group_folder,
    userId: null,
    inputText: task.prompt,
    source: 'dotclaw-scheduler'
  });

  try {
    const execution = await executeAgentRun({
      group,
      prompt: taskPrompt,
      chatJid: task.chat_jid,
      userId: null,
      recallQuery: task.prompt,
      recallMaxResults: runtime.host.memory.recall.maxResults,
      recallMaxTokens: runtime.host.memory.recall.maxTokens,
      sessionId,
      persistSession: task.context_mode === 'group',
      onSessionUpdate: (sessionId) => deps.setSession(task.group_folder, sessionId),
      isScheduledTask: true,
      taskId: task.id
    });
    output = execution.output;
    context = execution.context;

    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else {
      result = output.result;
    }
  } catch (err) {
    if (err instanceof AgentExecutionError) {
      context = err.context;
      error = err.message;
    } else {
      error = err instanceof Error ? err.message : String(err);
    }
    logger.error({ taskId: task.id, error }, 'Task failed');
  }

  if (context) {
    recordAgentTelemetry({
      traceBase,
      output,
      context,
      metricsSource: 'scheduler',
      toolAuditSource: 'scheduler',
      errorMessage: error ?? undefined,
      errorType: error ? 'scheduler' : undefined
    });
  } else if (error) {
    recordError('scheduler');
    writeTrace({
      trace_id: traceBase.trace_id,
      timestamp: traceBase.timestamp,
      created_at: traceBase.created_at,
      chat_id: traceBase.chat_id,
      group_folder: traceBase.group_folder,
      input_text: traceBase.input_text,
      output_text: null,
      model_id: 'unknown',
      memory_recall: [],
      error_code: error,
      source: traceBase.source
    });
  }

  if (!error) {
    logger.info({ taskId: task.id, durationMs: Date.now() - startTime }, 'Task completed');
  }

  const durationMs = Date.now() - startTime;

  logTaskRun({
    task_id: task.id,
    run_at: new Date().toISOString(),
    duration_ms: durationMs,
    status: error ? 'error' : 'success',
    result,
    error
  });
  recordTaskRun(error ? 'error' : 'success');

  let scheduleNextRun: string | null = null;
  let scheduleError: string | null = null;
  if (task.schedule_type === 'cron') {
    try {
      const interval = CronExpressionParser.parse(task.schedule_value, { tz: TIMEZONE });
      scheduleNextRun = interval.next().toISOString();
    } catch (err) {
      scheduleError = `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (isNaN(ms) || ms <= 0) {
      scheduleError = `Invalid interval: "${task.schedule_value}"`;
    } else {
      scheduleNextRun = new Date(Date.now() + ms).toISOString();
    }
  }
  // 'once' tasks have no next run

  if (scheduleError) {
    error = error ? `${error}; ${scheduleError}` : scheduleError;
  }

  let nextRun = scheduleNextRun;
  let retryCount = typeof task.retry_count === 'number' ? task.retry_count : 0;
  if (error) {
    if (retryCount < TASK_MAX_RETRIES) {
      retryCount += 1;
      const backoff = Math.min(TASK_RETRY_MAX_MS, TASK_RETRY_BASE_MS * Math.pow(2, retryCount - 1));
      nextRun = new Date(Date.now() + backoff).toISOString();
    }
  } else {
    retryCount = 0;
  }

  const resultSummary = error ? `Error: ${error}` : (result ? result.slice(0, 200) : 'Completed');
  updateTaskAfterRun(task.id, nextRun, resultSummary, error, retryCount);

  if (scheduleError) {
    updateTask(task.id, { status: 'paused', next_run: null });
  }
}


export function startSchedulerLoop(deps: SchedulerDependencies): void {
  logger.info('Scheduler loop started');

  const loop = async () => {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length > 0) {
        logger.info({ count: dueTasks.length }, 'Found due tasks');
      }

      for (const task of dueTasks) {
        // Re-check task status in case it was paused/cancelled
        const currentTask = getTaskById(task.id);
        if (!currentTask || currentTask.status !== 'active') {
          continue;
        }

        await runTask(currentTask, deps);
      }
    } catch (err) {
      logger.error({ err }, 'Error in scheduler loop');
    }

    setTimeout(loop, SCHEDULER_POLL_INTERVAL);
  };

  loop();
}
