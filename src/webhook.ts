import http from 'http';
import type { RegisteredGroup } from './types.js';
import { createTraceBase, executeAgentRun, recordAgentTelemetry, AgentExecutionError } from './agent-execution.js';
import { routeRequest } from './request-router.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { logger } from './logger.js';

export interface WebhookConfig {
  enabled: boolean;
  port: number;
  token: string;
}

export interface WebhookDeps {
  registeredGroups: () => Record<string, RegisteredGroup>;
  sessions: () => Record<string, string>;
  setSession: (folder: string, id: string) => void;
}

let server: http.Server | null = null;

function parseBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function startWebhookServer(config: WebhookConfig, deps: WebhookDeps): void {
  if (!config.enabled || !config.token) {
    logger.info('Webhook server disabled');
    return;
  }

  const runtime = loadRuntimeConfig();
  const bind = runtime.host.bind;

  server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    // Health check
    if (url === '/webhook/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Only accept POST to /webhook/:groupFolder
    if (req.method !== 'POST' || !url.startsWith('/webhook/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Auth
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${config.token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    const groupFolder = url.replace('/webhook/', '').replace(/\/$/, '');
    if (!groupFolder) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing group folder in URL' }));
      return;
    }

    // Find registered group by folder name
    const groups = deps.registeredGroups();
    const group = Object.values(groups).find(g => g.folder === groupFolder);
    if (!group) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Group "${groupFolder}" not found` }));
      return;
    }

    let body: { message?: string; userId?: string; metadata?: Record<string, unknown> };
    try {
      const raw = await parseBody(req);
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    if (!body.message || typeof body.message !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "message" field' }));
      return;
    }

    const routing = routeRequest();
    const traceBase = createTraceBase({
      chatId: `webhook:${groupFolder}`,
      groupFolder: group.folder,
      userId: body.userId ?? undefined,
      inputText: body.message,
      source: 'webhook'
    });

    try {
      const sessions = deps.sessions();
      const { output, context } = await executeAgentRun({
        group,
        prompt: body.message,
        chatJid: `webhook:${groupFolder}`,
        userId: body.userId ?? undefined,
        recallQuery: body.message,
        recallMaxResults: routing.recallMaxResults,
        recallMaxTokens: routing.recallMaxTokens,
        sessionId: sessions[group.folder],
        onSessionUpdate: (sessionId) => { deps.setSession(group.folder, sessionId); },
        modelFallbacks: routing.fallbacks,
        modelMaxOutputTokens: routing.maxOutputTokens || undefined,
        maxToolSteps: routing.maxToolSteps,
        useGroupLock: true,
        useSemaphore: true,
      });

      recordAgentTelemetry({
        traceBase,
        output,
        context,
        metricsSource: 'webhook',
        toolAuditSource: 'message',
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: output.status,
        result: output.result,
        model: output.model,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ groupFolder, err }, 'Webhook agent error');
      if (err instanceof AgentExecutionError) {
        recordAgentTelemetry({
          traceBase,
          output: null,
          context: err.context,
          metricsSource: 'webhook',
          toolAuditSource: 'message',
          errorMessage: message,
          errorType: 'agent',
        });
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  });

  server.listen(port(config.port), bind, () => {
    logger.info({ port: config.port, bind }, 'Webhook server started');
  });
}

function port(p: number): number {
  return Number.isFinite(p) && p > 0 ? p : 3003;
}

export function stopWebhookServer(): void {
  if (server) {
    server.close();
    server = null;
  }
}
