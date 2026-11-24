// Reference handler for the PROPOSED search_posts(_next) actions. Used ONLY by the local mock server.
// It shows the behaviour the conformance kit expects from AgentWeb's executor: flat-param validation,
// a cursor bound to its query, termination, and rows in the proposed shape.
// The part it cannot provide is the content-search source itself. That is AgentWeb-owned and not public;
// here it is an injected `source` (synthetic fixtures in the demo), and `unavailableSource` stands in for the real one.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { DOMAIN, SEARCH_ACTION, SEARCH_NEXT_ACTION, queryFingerprint, validateSearchParams } from './contract.js';
import { AgentWebError, errorFromCode } from './errors.js';
import { normalizeRow } from './normalize.js';

/**
 * @typedef {Object} PostSearchSource  Internal seam. AgentWeb's real equivalent is not public.
 * @property {(q: {keywords: string, sort: string, date_posted: string, count: number, offset: number}) => Promise<{rows: any[], nextOffset: number|null}>} fetchPage
 */

/** Stand-in for the missing AgentWeb-owned content-search source. Always fails, loudly. */
export const unavailableSource = Object.freeze({
  async fetchPage() {
    throw errorFromCode({ code: 'UPSTREAM_ERROR', message: 'No LinkedIn content-search source: this needs the AgentWeb-owned content-search capture inside the executor, which is not public.' }, { domain: DOMAIN, action: SEARCH_ACTION });
  },
});

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

/** Opaque, signed cursor bound to the query fingerprint. */
export function makeCursorCodec(secret) {
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url').slice(0, 22);
  return {
    encode(fp, offset) { const p = b64(JSON.stringify({ v: 1, fp, o: offset })); return `${p}.${sign(p)}`; },
    /** @returns {{fp: string, o: number}|null} */
    decode(token) {
      if (typeof token !== 'string' || !token.includes('.')) return null;
      const [p, sig] = token.split('.');
      const want = sign(p);
      if (!sig || sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
      try { const j = JSON.parse(unb64(p)); return j?.v === 1 && Number.isInteger(j.o) ? j : null; } catch { return null; }
    },
  };
}

const MIRROR_FIELDS = ['text', 'age', 'reactions', 'comments', 'reposts', 'author', 'author_headline', 'author_url', 'header', 'activity_urn', 'thread_urn', 'thread_id', 'reshared_author', 'reshared_text'];

/** Shape a source row into the proposed output row: mirrored fields + permalink + posted_at_approx. */
export function toProposedRow(row, now) {
  const n = normalizeRow(row, { now });
  const out = {};
  for (const f of MIRROR_FIELDS) out[f] = row[f] ?? (['reactions', 'comments', 'reposts'].includes(f) ? 0 : null);
  out.permalink = n.permalink;
  // Say where the link came from, so a constructed /feed/update/ URL is never passed off as a real share URL.
  out.permalink_source = n.permalink_source;
  out.posted_at_approx = n.posted_at?.iso ?? null;
  if (row.reshared_activity_urn !== undefined) out.reshared_activity_urn = row.reshared_activity_urn;
  if (row.synthetic) out.synthetic = true;
  return out;
}

/**
 * @param {{source: PostSearchSource, cursorSecret: string, now?: () => Date, faults?: {unboundCursor?: boolean, loopingToken?: boolean, duplicateRows?: boolean}}} o
 * @returns {(action: string, params: Record<string, any>) => Promise<{kind: 'json', value: any}>}  throws AgentWebError
 */
export function createSearchPostsHandler(o) {
  const codec = makeCursorCodec(o.cursorSecret);
  const faults = o.faults ?? {};
  return async function handle(action, params) {
    if (action !== SEARCH_ACTION && action !== SEARCH_NEXT_ACTION) throw errorFromCode({ code: 'ACTION_NOT_FOUND', message: `Action "${action}" not found` }, { domain: DOMAIN, action });
    const p = validateSearchParams(action, params); // throws InvalidParamsError
    const fp = queryFingerprint(p);
    let offset = 0;
    if (action === SEARCH_NEXT_ACTION) {
      const c = codec.decode(p.pagination_token);
      if (!c) throw errorFromCode({ code: 'INVALID_PARAMS', message: 'pagination_token is not a valid token for search_posts' }, { domain: DOMAIN, action });
      if (!faults.unboundCursor && c.fp !== fp) throw errorFromCode({ code: 'INVALID_PARAMS', message: 'pagination_token was issued for a different query (keywords, sort or date_posted changed)' }, { domain: DOMAIN, action });
      offset = c.o;
    }
    let page;
    try {
      page = await o.source.fetchPage({ keywords: p.keywords, sort: p.sort, date_posted: p.date_posted, count: p.count, offset });
    } catch (e) {
      if (e instanceof AgentWebError) throw e;
      throw errorFromCode({ code: 'UPSTREAM_ERROR', message: String(e?.message ?? e) }, { domain: DOMAIN, action });
    }
    const now = o.now ? o.now() : new Date();
    const seen = new Set();
    let rows = page.rows.filter((r) => (r.activity_urn && seen.has(r.activity_urn) ? false : (seen.add(r.activity_urn), true)));
    if (faults.duplicateRows && offset > 0 && rows.length) rows = [{ ...rows[0], activity_urn: page.firstUrnOfQuery ?? rows[0].activity_urn }, ...rows];
    let next = page.nextOffset == null ? null : codec.encode(fp, page.nextOffset);
    if (faults.loopingToken && next === null && offset > 0) next = codec.encode(fp, offset); // never terminates
    return {
      kind: 'json',
      value: {
        query: { keywords: p.keywords, sort: p.sort, date_posted: p.date_posted },
        posts: rows.map((r) => toProposedRow(r, now)),
        next_token: next,
      },
    };
  };
}
