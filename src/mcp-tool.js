// Thin MCP-compatible tool DEFINITION and HANDLER for `linkedin_search_posts`. This is not an MCP server: no transport
// or runtime is included. An MCP host would register the definition and call the handler.
// The handler calls the PROPOSED search_posts action through the execute client. Today, unless the map
// contains search_posts, it returns a clear UnsupportedActionError result instead of results.

import { MAP_ENTRY, SEARCH_ACTION, DOMAIN } from './contract.js';
import { probeSearchPosts } from './probe.js';
import { searchPosts } from './search.js';
import { AgentWebError, UnsupportedActionError } from './errors.js';
import { explain } from './rank.js';

const sp = MAP_ENTRY.actions[0].params;

export const linkedinSearchPostsTool = Object.freeze({
  name: 'linkedin_search_posts',
  description: 'Keyword search of LinkedIn posts via the PROPOSED AgentWeb action linkedin.com/search_posts, then deterministic hiring-intent ranking. Returns an UnsupportedActionError result while AgentWeb\'s map lacks search_posts. Read-only on LinkedIn. Each page is expected to bill as one AgentWeb action (about 1 credit per the docs; an estimate, since per-page billing is unconfirmed), so repeat calls can bill again.',
  input_schema: {
    type: 'object',
    required: ['keywords'],
    additionalProperties: false,
    properties: {
      keywords: { type: 'string', minLength: 1, maxLength: sp.keywords.maxLength, description: 'Passed through unchanged.' },
      sort: { type: 'string', enum: sp.sort.enum, default: sp.sort.default },
      date_posted: { type: 'string', enum: sp.date_posted.enum, default: sp.date_posted.default },
      count: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      max_pages: { type: 'integer', minimum: 1, maximum: 10, default: 2, description: 'Pages to fetch; each is expected to bill as one action (estimate). Clamped to 1..10.' },
      only_likely_hiring: { type: 'boolean', default: false },
    },
  },
  annotations: { title: 'Search LinkedIn posts (proposed)', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
});

const errorResult = (e) => ({
  isError: true,
  content: [{ type: 'text', text: `${e.name}: ${e.message}` }],
  structuredContent: { error: { type: e.name, ...(e.toJSON ? e.toJSON() : { message: String(e) }) } },
});

/**
 * @param {{client: {execute: Function}, map?: any, now?: Date, maxCredits?: number|null}} deps
 *   map: a map JSON to probe first. If given and search_posts is not supported, no execute call is made.
 */
export function createLinkedinSearchPostsHandler(deps) {
  return async function handle(args = {}) {
    if (deps.map !== undefined) {
      const probe = probeSearchPosts(deps.map);
      if (probe.status !== 'supported') {
        return errorResult(new UnsupportedActionError({
          code: 'ACTION_NOT_FOUND', domain: DOMAIN, action: SEARCH_ACTION,
          message: `Probe of map ${probe.map_version ?? '(unknown version)'}: ${probe.status}${probe.problems.length ? ` (${probe.problems.join('; ')})` : ''}. No call was made.`,
        }));
      }
    }
    const { max_pages, only_likely_hiring, ...params } = args;
    // The schema maximum is advisory on the wire, so clamp here; the default budget equals the page count.
    const req = Math.trunc(Number(max_pages ?? 2));
    const pages = Math.min(Math.max(1, Number.isFinite(req) ? req : 2), 10);
    try {
      const r = await searchPosts({ client: deps.client, params, maxPages: pages, filter: Boolean(only_likely_hiring), now: deps.now, maxCredits: deps.maxCredits === undefined ? pages : deps.maxCredits });
      if (r.error && r.posts.length === 0) return errorResult(r.error);
      const items = r.ranked.map((x) => ({ ...x.post, hiring: { score: x.score, label: x.label, why: explain(x) } }));
      const out = { coverage: r.coverage, query: r.query, complete: r.complete, stop_reason: r.stopReason, partial_error: r.error ? r.error.toJSON?.() ?? String(r.error) : null, warnings: r.warnings, posts: items };
      return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
    } catch (e) {
      if (e instanceof AgentWebError) return errorResult(e);
      throw e;
    }
  };
}
