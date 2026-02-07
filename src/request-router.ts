import { loadRuntimeConfig } from './runtime-config.js';

export type RoutingDecision = {
  model: string;
  fallbacks: string[];
  maxOutputTokens: number;
  maxToolSteps: number;
  temperature?: number;
  recallMaxResults: number;
  recallMaxTokens: number;
};

/**
 * Filter a model chain against an allowlist.
 * If the allowlist is empty, all models are allowed.
 * The primary model is always kept (even if not in the allowlist)
 * to avoid completely breaking routing.
 */
function applyAllowlist(model: string, fallbacks: string[], allowedModels: string[]): { model: string; fallbacks: string[] } {
  if (!allowedModels || allowedModels.length === 0) {
    return { model, fallbacks };
  }
  const allowed = new Set(allowedModels);
  const filteredFallbacks = fallbacks.filter(m => allowed.has(m));
  // Primary model stays even if not in allowlist — prevents total routing failure
  return { model, fallbacks: filteredFallbacks };
}

export function routeRequest(): RoutingDecision {
  const r = loadRuntimeConfig().host.routing;
  const { model, fallbacks } = applyAllowlist(r.model, r.fallbacks, r.allowedModels);
  return {
    model,
    fallbacks,
    maxOutputTokens: r.maxOutputTokens,
    maxToolSteps: r.maxToolSteps,
    temperature: r.temperature,
    recallMaxResults: r.recallMaxResults,
    recallMaxTokens: r.recallMaxTokens,
  };
}