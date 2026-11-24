// Watchlist filter: a fallback built only from EXISTING linkedin.com actions
// (list_profile_posts, list_profile_posts_next, as listed publicly on 24 Nov 2026).
// It reads the recent posts of profiles the caller already knows, then filters them locally by keywords.
// It is NOT search: it cannot find posts by anyone outside the list. Coverage is always "watchlist".

import { DOMAIN } from '../contract.js';
import { DOCUMENTED_CREDITS_PER_ACTION_ESTIMATE, walkPages } from '../paginate.js';
import { dedupePosts, normalizeRow } from '../normalize.js';
import { rankPosts } from '../rank.js';
import { InsufficientCreditsError } from '../errors.js';

export const LIST_ACTION = 'list_profile_posts';
export const LIST_NEXT_ACTION = 'list_profile_posts_next';

/**
 * Parse a keyword string into a local matcher. This is an approximation for filtering text we already have;
 * it is not LinkedIn's query semantics. Supports "quoted phrases", OR between groups, and NOT/-term exclusions.
 * Terms within a group must all appear (AND). Case-insensitive.
 * @param {string} keywords
 */
export function compileKeywordFilter(keywords) {
  const tokens = [];
  const re = /(-?)"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(keywords)) !== null) {
    if (m[2] !== undefined) tokens.push({ neg: m[1] === '-', term: m[2].toLowerCase(), phrase: true });
    else tokens.push({ raw: m[3] });
  }
  const groups = [[]];
  const exclude = [];
  let nextNeg = false;
  for (const t of tokens) {
    if (t.raw === 'OR') { groups.push([]); continue; }
    if (t.raw === 'AND') continue;
    if (t.raw === 'NOT') { nextNeg = true; continue; }
    let term; let neg = nextNeg; nextNeg = false;
    if (t.raw !== undefined) {
      if (t.raw.startsWith('-') && t.raw.length > 1) { neg = true; term = t.raw.slice(1).toLowerCase(); }
      else term = t.raw.toLowerCase();
      term = term.replace(/^[()]+|[()]+$/g, '');
      if (!term) continue;
    } else { term = t.term; neg = neg || t.neg; }
    (neg ? exclude : groups[groups.length - 1]).push(term);
  }
  const live = groups.filter((g) => g.length);
  return (text) => {
    const t = String(text ?? '').toLowerCase();
    if (exclude.some((x) => t.includes(x))) return false;
    if (!live.length) return true;
    return live.some((g) => g.every((x) => t.includes(x)));
  };
}

/**
 * Cost estimate from the documented "~1 credit per completed action". An ESTIMATE, not a quote.
 * @param {{profiles: number, pagesPerProfile: number, searchPages?: number}} o
 */
export function estimateCost(o) {
  const per = DOCUMENTED_CREDITS_PER_ACTION_ESTIMATE;
  return {
    label: 'estimate from AgentWeb docs ("~1 credit per completed action"); real per-action price is returned at run time and may differ',
    watchlist_max_credits: o.profiles * o.pagesPerProfile * per,
    proposed_search_credits: o.searchPages != null ? o.searchPages * per : null,
    assumption_search: 'one page of the proposed search_posts billed as one action (unconfirmed)',
  };
}

const PROFILE_ID_RE = /^ACoAA[A-Za-z0-9_-]+$/;

/**
 * @param {Object} o
 * @param {{execute: Function}} o.client
 * @param {string[]} o.profileIds       ACoAA-form ids (as get_profile returns, per the public listing)
 * @param {string} o.keywords           filter applied locally to post text and reposted text
 * @param {number} [o.count=20]         list_profile_posts count (max 100)
 * @param {number} [o.pagesPerProfile=1]
 * @param {number|null} [o.maxCredits]  budget across the whole watchlist
 * @param {boolean} [o.rank=true]
 * @param {Date} [o.now]
 * @param {string} [o.walkId]
 */
export async function watchlistFilter(o) {
  const bad = o.profileIds.filter((id) => !PROFILE_ID_RE.test(id));
  if (bad.length) throw new TypeError(`profile ids must be ACoAA-form; rejected: ${bad.join(', ')}`);
  const n = Number(o.count ?? 20);
  const count = Number.isInteger(n) ? Math.min(Math.max(1, n), 100) : 20;
  const pagesPerProfile = o.pagesPerProfile ?? 1;
  const match = compileKeywordFilter(o.keywords);
  const perProfile = [];
  const allRows = [];
  let spent = 0;
  let stoppedEarly = null;

  for (const profileId of o.profileIds) {
    const walk = await walkPages({
      client: o.client,
      domain: DOMAIN,
      first: { action: LIST_ACTION, params: { profile_id: profileId, count } },
      next: (token) => ({ action: LIST_NEXT_ACTION, params: { profile_id: profileId, pagination_token: token, count } }),
      maxPages: pagesPerProfile,
      maxCredits: o.maxCredits ?? null,
      creditsAlreadySpent: spent,
      walkId: o.walkId ? `${o.walkId}:${profileId}` : undefined,
      meta: { flow: 'watchlist', profile_id: profileId },
    });
    spent = walk.creditsCountedForBudget;
    perProfile.push({ profile_id: profileId, pages: walk.pages.length, rows: walk.rows.length, stopReason: walk.stopReason, error: walk.error ? walk.error.toJSON?.() ?? String(walk.error) : null });
    for (const r of walk.rows) allRows.push(r.row);
    if (walk.stopReason === 'budget' || walk.error instanceof InsufficientCreditsError) { stoppedEarly = walk.stopReason === 'budget' ? 'budget' : 'INSUFFICIENT_CREDITS'; break; }
    // Account-level conditions would repeat for every remaining profile, so stop instead of re-billing the failure.
    const accountCode = walk.error?.code;
    if (['AUTH_REQUIRED', 'AUTH_MISCONFIGURED', 'UNAUTHORIZED', 'FORBIDDEN', 'RATE_LIMITED', 'BILLING_ACCOUNT_RESTRICTED', 'BILLING_UNAVAILABLE', 'USAGE_CAP_EXCEEDED'].includes(accountCode)) { stoppedEarly = accountCode; break; }
  }

  const normalised = allRows.map((r) => normalizeRow(r, { now: o.now }));
  const { posts, duplicates_removed } = dedupePosts(normalised);
  const matched = posts.filter((p) => match(`${p.text}\n${p.repost?.original.text ?? ''}`));
  return {
    coverage: 'watchlist',
    not_search: true,
    coverage_note: `Only posts by the ${o.profileIds.length} listed profile(s) were read; posts by anyone else cannot appear.`,
    keywords: o.keywords,
    posts: matched,
    ranked: o.rank === false ? null : rankPosts(matched),
    scanned: posts.length,
    duplicates_removed,
    per_profile: perProfile,
    profiles_not_reached: [...perProfile.filter((p) => p.pages === 0 && p.stopReason === 'budget').map((p) => p.profile_id), ...o.profileIds.slice(perProfile.length)],
    stopped_early: stoppedEarly,
    cost_estimate: estimateCost({ profiles: o.profileIds.length, pagesPerProfile }),
  };
}
