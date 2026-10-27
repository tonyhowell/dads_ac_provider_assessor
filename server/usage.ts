import type Anthropic from '@anthropic-ai/sdk';

// The models enrichment uses, chosen for cost: Claude Haiku 5.5 reads pages and structures data (the bulk of
// the work, at a fraction of the price); Claude Sonnet 5.5 only for open web research, which needs the
// web search and web fetch tools with dynamic filtering. Change detection uses no model at all.

export const EXTRACT_MODEL = 'claude-haiku-5-5';
export const RESEARCH_MODEL = 'claude-sonnet-5-5';

/** US dollars per million tokens, and per web search. For the run log's cost estimate only. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  [EXTRACT_MODEL]: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  [RESEARCH_MODEL]: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
const PER_WEB_SEARCH = 0.01;

export interface ModelUsage {
  requests: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  web_searches: number;
  web_fetches: number;
}

type ApiUsage = Pick<Anthropic.Usage, 'input_tokens' | 'output_tokens'> & {
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null; web_fetch_requests?: number | null } | null;
};

/** Token and tool use across a run, by model, with an estimated cost. */
export class UsageTally {
  readonly byModel: Record<string, ModelUsage> = {};

  add(model: string, usage: ApiUsage | undefined | null): void {
    if (!usage) return;
    const m = (this.byModel[model] ??= { requests: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_searches: 0, web_fetches: 0 });
    m.requests += 1;
    m.input_tokens += usage.input_tokens ?? 0;
    m.output_tokens += usage.output_tokens ?? 0;
    m.cache_read_input_tokens += usage.cache_read_input_tokens ?? 0;
    m.cache_creation_input_tokens += usage.cache_creation_input_tokens ?? 0;
    m.web_searches += usage.server_tool_use?.web_search_requests ?? 0;
    m.web_fetches += usage.server_tool_use?.web_fetch_requests ?? 0;
  }

  estimatedCost(): number {
    let usd = 0;
    for (const [model, m] of Object.entries(this.byModel)) {
      const p = PRICES[model] ?? PRICES['claude-opus-5-5'];
      usd += (m.input_tokens * p.input + m.output_tokens * p.output + m.cache_read_input_tokens * p.cacheRead + m.cache_creation_input_tokens * p.cacheWrite) / 1e6;
      usd += m.web_searches * PER_WEB_SEARCH;
    }
    return Math.round(usd * 10000) / 10000;
  }

  toJSON() {
    return { models: this.byModel, estimated_cost_usd: this.estimatedCost() };
  }
}
