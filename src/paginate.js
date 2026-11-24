// Safe pagination walk over any first/next action pair (search_posts(_next) or list_profile_posts(_next)).
// Guards: max pages, repeated token (loop), empty pages with a token, map_version change, credit budget.
// A failure on page N returns the rows so far, the ledger entries and the error; it never throws for server errors.

import { randomUUID } from 'node:crypto';
import { AgentWebError, BudgetExceededError, TRANSIENT_CODES } from './errors.js';

/** Credits per completed action, as documented ("~1 credit per completed action"). An estimate, used only for the budget guard. */
export const DOCUMENTED_CREDITS_PER_ACTION_ESTIMATE = 1;

/**
 * Find rows and the next token in an action's value. Accepts the proposed {posts, next_token} shape and,
 * because list_profile_posts' exact output nesting is not public, also an array of rows or a per-row next_token.
 * @param {any} value
 * @returns {{rows: any[], nextToken: string|null, tokenLocation: 'top-level'|'row'|'none'}}
 */
export function extractPage(value) {
  let rows = [];
  if (Array.isArray(value)) rows = value;
  else if (value && typeof value === 'object') rows = value.posts ?? value.rows ?? value.items ?? value.results ?? [];
  if (!Array.isArray(rows)) rows = [];
  if (value && !Array.isArray(value) && typeof value === 'object' && 'next_token' in value) {
    return { rows, nextToken: value.next_token ?? null, tokenLocation: 'top-level' };
  }
  const last = rows.length ? rows[rows.length - 1] : null;
  if (last && typeof last === 'object' && 'next_token' in last) {
    return { rows, nextToken: last.next_token ?? null, tokenLocation: 'row' };
  }
  return { rows, nextToken: null, tokenLocation: 'none' };
}

/**
 * @typedef {'end_of_results'|'max_pages'|'repeated_token'|'empty_pages'|'budget'|'map_version_changed'|'error'} StopReason
 */

/**
 * @param {Object} o
 * @param {{execute: Function}} o.client
 * @param {string} o.domain
 * @param {{action: string, params: Record<string, any>}} o.first
 * @param {(token: string, page: number) => {action: string, params: Record<string, any>}} o.next
 * @param {number} [o.maxPages=5]
 * @param {number} [o.maxEmptyPages=2]   consecutive empty pages (with a token) tolerated before stopping
 * @param {number|null} [o.maxCredits]   client-side budget; null = no guard
 * @param {number} [o.creditsAlreadySpent=0] counted against maxCredits (for multi-walk budgets)
 * @param {string} [o.walkId]            prefix for per-page Idempotency-Keys
 * @param {boolean} [o.fresh]
 * @param {number} [o.retries=0]         retries per page for transient codes, reusing the same key
 * @param {string[]} [o.retryOn]
 * @param {number} [o.retryDelayMs=0]    caller-chosen delay when the server sent no Retry-After
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {number} [o.maxRetryWaitMs=30000] a Retry-After longer than this is not waited out; the walk stops with the error
 * @param {boolean} [o.stopOnMapVersionChange=false]
 * @param {Record<string, unknown>} [o.meta]
 */
export async function walkPages(o) {
  const maxPages = o.maxPages ?? 5;
  const maxEmpty = o.maxEmptyPages ?? 2;
  const walkId = o.walkId ?? randomUUID();
  const retries = o.retries ?? 0;
  const retryOn = o.retryOn ?? TRANSIENT_CODES;
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxRetryWaitMs = o.maxRetryWaitMs ?? 30_000;

  /** @type {{row: any, page: number, mapVersion: string|null}[]} */
  const rows = [];
  const pages = [];
  const warnings = [];
  const seenTokens = new Set();
  let counted = o.creditsAlreadySpent ?? 0;
  let reported = 0;
  let firstMapVersion = null;
  let emptyStreak = 0;
  /** @type {StopReason} */
  let stopReason = 'max_pages';
  let error = null;
  let token = null;

  for (let page = 1; page <= maxPages; page++) {
    let req;
    try {
      req = page === 1 ? o.first : o.next(token, page);
    } catch (e) {
      // e.g. the server returned a token the next-request builder rejects; keep the rows already paid for
      stopReason = 'error';
      error = e;
      break;
    }
    if (o.maxCredits != null && counted + DOCUMENTED_CREDITS_PER_ACTION_ESTIMATE > o.maxCredits) {
      stopReason = 'budget';
      error = new BudgetExceededError({ code: 'CLIENT_BUDGET', message: `Next call would exceed the credit budget (${counted} counted + ~${DOCUMENTED_CREDITS_PER_ACTION_ESTIMATE} estimated > ${o.maxCredits})` });
      break;
    }
    const key = `${walkId}:${req.action}:p${page}`;
    let res = null;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        res = await o.client.execute({ domain: o.domain, action: req.action, params: req.params }, { idempotencyKey: key, fresh: o.fresh, meta: { ...o.meta, page, attempt } });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (typeof e?.billing?.credits === 'number') { counted += e.billing.credits; reported += e.billing.credits; }
        const transient = e instanceof AgentWebError && retryOn.includes(e.code);
        if (!transient || attempt === retries) break;
        let ra = o.retryDelayMs ?? 0;
        if (e.retryAfter != null) {
          const v = String(e.retryAfter).trim();
          if (/^\d+$/.test(v)) ra = Number(v) * 1000;
          else { const t = Date.parse(v); ra = Number.isNaN(t) ? Infinity : Math.max(0, t - Date.now()); } // HTTP-date; unparseable → not waited out
        }
        if (ra > maxRetryWaitMs) {
          warnings.push({ type: 'retry_wait_exceeds_limit', page, waitMs: ra, maxRetryWaitMs });
          break;
        }
        await sleep(ra);
      }
    }
    if (lastErr) { stopReason = 'error'; error = lastErr; break; }

    const credits = res.billing?.credits;
    if (typeof credits === 'number') { counted += credits; reported += credits; }
    else { counted += DOCUMENTED_CREDITS_PER_ACTION_ESTIMATE; warnings.push({ type: 'credits_not_reported', page, note: `counted as ~${DOCUMENTED_CREDITS_PER_ACTION_ESTIMATE} (documented estimate) for the budget guard only` }); }

    if (firstMapVersion == null) firstMapVersion = res.mapVersion ?? null;
    else if (res.mapVersion != null && res.mapVersion !== firstMapVersion) {
      warnings.push({ type: 'map_version_changed', page, from: firstMapVersion, to: res.mapVersion });
    }

    const { rows: pageRows, nextToken, tokenLocation } = extractPage(res.value);
    for (const r of pageRows) rows.push({ row: r, page, mapVersion: res.mapVersion });
    pages.push({ page, action: req.action, rows: pageRows.length, nextToken, tokenLocation, mapVersion: res.mapVersion, cached: res.cached, idempotencyKey: key });
    if (res.cached) warnings.push({ type: 'cached_page', page, notes: res.notes });

    if (o.stopOnMapVersionChange && warnings.some((w) => w.type === 'map_version_changed' && w.page === page)) { stopReason = 'map_version_changed'; break; }
    if (nextToken === null || nextToken === undefined || nextToken === '') { stopReason = 'end_of_results'; break; }
    if (seenTokens.has(nextToken)) {
      stopReason = 'repeated_token';
      warnings.push({ type: 'repeated_token', page, note: 'next_token was already used in this walk; stopped to avoid a loop' });
      break;
    }
    seenTokens.add(nextToken);
    if (pageRows.length === 0) {
      emptyStreak += 1;
      warnings.push({ type: 'empty_page_with_token', page });
      if (emptyStreak >= maxEmpty) { stopReason = 'empty_pages'; break; }
    } else emptyStreak = 0;
    token = nextToken;
  }

  return {
    rows,
    pages,
    stopReason,
    complete: stopReason === 'end_of_results',
    error,
    warnings,
    creditsReported: reported,
    creditsCountedForBudget: counted,
    walkId,
  };
}
