// Client-side flow for the PROPOSED search_posts(_next) actions:
// validate → walk pages over execute → normalise → dedupe → (optionally) rank.
// Against AgentWeb today this ends in UnsupportedActionError, because search_posts is not in the map.

import { DOMAIN, SEARCH_ACTION, SEARCH_NEXT_ACTION, validateSearchParams } from './contract.js';
import { walkPages } from './paginate.js';
import { dedupePosts, normalizeRow } from './normalize.js';
import { rankPosts } from './rank.js';

/**
 * @param {Object} o
 * @param {{execute: Function}} o.client
 * @param {Record<string, any>} o.params           keywords, sort, date_posted, count
 * @param {number} [o.maxPages=3]
 * @param {number|null} [o.maxCredits]
 * @param {boolean} [o.rank=true]
 * @param {boolean} [o.filter=false]             keep only likely hiring posts
 * @param {Date} [o.now]
 * @param {string} [o.walkId]
 * @param {boolean} [o.fresh]
 */
export async function searchPosts(o) {
  const p = validateSearchParams(SEARCH_ACTION, o.params);
  const walk = await walkPages({
    client: o.client,
    domain: DOMAIN,
    first: { action: SEARCH_ACTION, params: p },
    next: (token) => ({ action: SEARCH_NEXT_ACTION, params: validateSearchParams(SEARCH_NEXT_ACTION, { ...p, pagination_token: token }) }),
    maxPages: o.maxPages ?? 3,
    maxCredits: o.maxCredits ?? null,
    walkId: o.walkId,
    fresh: o.fresh,
    meta: { flow: 'search_posts' },
  });
  const normalised = walk.rows.map((r) => normalizeRow(r.row, { now: o.now }));
  const { posts, duplicates_removed } = dedupePosts(normalised);
  const ranked = o.rank === false ? null : rankPosts(posts, { filter: Boolean(o.filter) });
  return {
    coverage: 'search_posts (proposed action)',
    query: { keywords: p.keywords, sort: p.sort, date_posted: p.date_posted, count: p.count },
    posts,
    ranked,
    duplicates_removed,
    stopReason: walk.stopReason,
    complete: walk.complete,
    error: walk.error,
    warnings: walk.warnings,
    pages: walk.pages,
    creditsReported: walk.creditsReported,
  };
}
