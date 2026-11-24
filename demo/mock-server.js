#!/usr/bin/env node
// MOCK AgentWeb execute server (node:http). SYNTHETIC data only. It does not contact LinkedIn or AgentWeb.
//
// Speaks the documented envelopes (saved public docs, 24 Nov 2026):
//   REST success, billing style "top":   {ok:true, result, credits_charged, charged, charge_unit, balance_remaining, support_id}
//   REST success, billing style "block": {ok:true, result, billing:{credits_charged, balance_remaining, receipt_id, policy}}
//   REST failure:                        {ok:false, error:{code,message,...}, trace_id, support_id} + documented HTTP status
//   MCP envelope (in-process only):      {success, domain, action, data, duration_ms, map_version, error?, trace_id?, billing}
//
// Implements: linkedin.com list_profile_posts, list_profile_posts_next (existing actions, synthetic rows) and
// the PROPOSED search_posts, search_posts_next (via src/reference-handler.js over a synthetic corpus).
// With searchMissing=true, search_posts returns ACTION_NOT_FOUND, which matches AgentWeb's real map today.
//
// Mock-only request headers (never part of AgentWeb's API):
//   x-mock-simulate: <ERROR_CODE> | RATE_LIMITED_PLAIN   force a failure envelope
//   x-mock-retry-after: <value>                          add a Retry-After header to a 429
//   x-mock-cached: 1                                     mark the result notes "cached" unless body.fresh is true
//   x-mock-map-version: <v>                              report a different map_version for this call

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createSearchPostsHandler, makeCursorCodec } from '../src/reference-handler.js';
import { compileKeywordFilter } from '../src/sources/watchlist.js';
import { approxPostedAt } from '../src/normalize.js';
import { canonicalJson } from '../src/contract.js';
import { AgentWebError, ERROR_CODES } from '../src/errors.js';

const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const POLICY = 'MOCK: credits are debited only on a completed action; failed actions are refunded (synthetic ledger).';
const DATE_WINDOWS = { any: null, past_24h: 86_400_000, past_week: 7 * 86_400_000, past_month: 30 * 86_400_000 };
const EXISTING = ['get_me', 'get_profile', 'list_profile_posts', 'list_profile_posts_next', 'search_people', 'list_post_comments'];

/** Synthetic corpus "search": local keyword filter, date window, sort. Labelled mock semantics, not LinkedIn's. */
export function fixtureSearchSource(corpus, now) {
  return {
    async fetchPage({ keywords, sort, date_posted, count, offset }) {
      const match = compileKeywordFilter(keywords);
      const t = now();
      let rows = corpus.filter((r) => match(`${r.text}\n${r.reshared_text ?? ''}`));
      const win = DATE_WINDOWS[date_posted];
      const at = (r) => Date.parse(approxPostedAt(r.age, t)?.iso ?? 0);
      if (win) rows = rows.filter((r) => t.getTime() - at(r) <= win);
      if (sort === 'latest') rows = rows.map((r, i) => [r, i]).sort((a, b) => at(b[0]) - at(a[0]) || a[1] - b[1]).map((x) => x[0]);
      const slice = rows.slice(offset, offset + count);
      return { rows: slice, nextOffset: offset + count < rows.length ? offset + count : null, firstUrnOfQuery: rows[0]?.activity_urn };
    },
  };
}

/**
 * @param {Object} [o]
 * @param {boolean} [o.searchMissing=false]  simulate today's real state: search_posts not in the map
 * @param {'top'|'block'} [o.billingStyle='top']
 * @param {number|null} [o.startingBalance=1000]  null = unmetered (balance_remaining null)
 * @param {{unboundCursor?: boolean, loopingToken?: boolean, duplicateRows?: boolean}} [o.faults]  deliberately broken behaviours, to prove the conformance kit catches them
 * @param {() => Date} [o.now]
 * @param {string} [o.mapVersion]
 */
export function createMockCore(o = {}) {
  const now = o.now ?? (() => new Date('2026-11-24T00:00:00.000Z'));
  const corpus = load('search-corpus.synthetic.json').rows;
  const profiles = load('profile-posts.synthetic.json').profiles;
  const mapVersion = o.mapVersion ?? '0.7.2-mock';
  const billingStyle = o.billingStyle ?? 'top';
  const state = { balance: o.startingBalance === undefined ? 1000 : o.startingBalance, seq: 0, idem: new Map(), calls: 0 };
  const search = createSearchPostsHandler({ source: fixtureSearchSource(corpus, now), cursorSecret: 'mock-cursor-secret', now, faults: o.faults });
  const listCodec = makeCursorCodec('mock-list-secret');

  const actionNames = () => [...EXISTING, ...(o.searchMissing ? [] : ['search_posts', 'search_posts_next'])];

  function fail(code, message, extra = {}) { return { ok: false, code, message, extra }; }

  async function listProfilePosts(action, params) {
    const allowed = action === 'list_profile_posts' ? ['profile_id', 'count'] : ['profile_id', 'pagination_token', 'count'];
    for (const k of Object.keys(params)) if (!allowed.includes(k)) return fail('INVALID_PARAMS', `unknown param "${k}"`);
    const pid = params.profile_id;
    if (typeof pid !== 'string' || !pid) return fail('INVALID_PARAMS', 'missing required param "profile_id"');
    const count = params.count === undefined ? 10 : Number(params.count);
    if (!Number.isInteger(count) || count < 1 || count > 100) return fail('INVALID_PARAMS', 'count must be an integer 1-100');
    let offset = 0;
    if (action === 'list_profile_posts_next') {
      const c = listCodec.decode(String(params.pagination_token ?? ''));
      if (!c || c.fp !== pid) return fail('INVALID_PARAMS', 'pagination_token is not valid for this profile_id');
      offset = c.o;
    }
    const all = profiles[pid] ?? [];
    const slice = all.slice(offset, offset + count);
    const next = offset + count < all.length ? listCodec.encode(pid, offset + count) : null;
    // ASSUMPTION (mock): next_token is carried on each row, because the public listing shows it among the row fields.
    return { ok: true, data: { kind: 'json', value: slice.map((r) => ({ ...r, next_token: next })) } };
  }

  async function run(domain, action, params) {
    if (domain !== 'linkedin.com') return fail('MAP_NOT_FOUND', `No action map for ${domain} (mock serves linkedin.com only)`);
    if (!actionNames().includes(action)) return fail('ACTION_NOT_FOUND', `Action "${action}" not found on linkedin.com. Available actions: ${actionNames().join(', ')} (mock subset).`);
    if (action === 'list_profile_posts' || action === 'list_profile_posts_next') return listProfilePosts(action, params);
    if (action === 'search_posts' || action === 'search_posts_next') {
      try { const data = await search(action, params); return { ok: true, data: { ...data, value: { synthetic: true, ...data.value } } }; }
      catch (e) { if (e instanceof AgentWebError) return fail(e.code, e.message); throw e; }
    }
    return fail('UPSTREAM_ERROR', `${action} is listed but not implemented in the mock`);
  }

  function simulated(code) {
    if (code === 'AUTH_REQUIRED') return fail(code, 'Connect LinkedIn first (mock).', { auth: { provider: 'linkedin', connect_url: 'https://example.invalid/mock-connect' } });
    if (code === 'INSUFFICIENT_CREDITS') return fail(code, 'Not enough credits (mock).', { credits: { top_up_url: 'https://example.invalid/mock-top-up' } });
    return fail(code, `Simulated ${code} (mock).`);
  }

  /** Core: returns an internal outcome plus receipt/trace bookkeeping. */
  async function executeCore(body, flags) {
    state.calls += 1;
    const seq = ++state.seq;
    const receipt = `awr_mock_${String(seq).padStart(6, '0')}`;
    const trace = `tr_mock_${String(seq).padStart(6, '0')}`;
    const mv = flags.mapVersion ?? mapVersion;
    let out;
    if (flags.simulate) out = simulated(flags.simulate);
    else if (state.balance !== null && state.balance < 1) out = simulated('INSUFFICIENT_CREDITS');
    else out = await run(body.domain, body.action, body.params ?? {});
    let charged = 0;
    if (out.ok) { charged = 1; if (state.balance !== null) state.balance -= 1; }
    const notes = out.ok && flags.cached && body.fresh !== true ? ['cached (mock): served from a saved synthetic copy'] : undefined;
    return { out, seq, receipt, trace, mv, charged, notes };
  }

  function envelopeFor(body, c) {
    const billing = { credits_charged: c.charged, balance_remaining: state.balance, receipt_id: c.receipt, policy: POLICY };
    if (c.out.ok) return { synthetic: true, success: true, domain: body.domain, action: body.action, data: c.out.data, duration_ms: 120, map_version: c.mv, ...(c.notes ? { notes: c.notes } : {}), billing };
    return { synthetic: true, success: false, domain: body.domain, action: body.action, data: null, error: { code: c.out.code, message: c.out.message, ...c.out.extra }, duration_ms: 3, map_version: c.mv, trace_id: c.trace, billing };
  }

  /** REST lane. @returns {Promise<{status: number, headers: Record<string,string>, body: any}>} */
  async function handleRest(req) {
    const h = req.headers;
    const auth = h['authorization'] ?? '';
    if (!/^Bearer aw_\S+/.test(auth)) return { status: 401, headers: {}, body: { error: 'Missing or invalid authorization.' } };
    const body = req.body;
    if (!body || typeof body !== 'object' || typeof body.domain !== 'string' || typeof body.action !== 'string') {
      return { status: 400, headers: {}, body: { synthetic: true, ok: false, error: { code: 'INVALID_PARAMS', message: 'domain and action are required' }, trace_id: 'tr_mock_badreq', support_id: null } };
    }
    if (h['x-mock-simulate'] === 'RATE_LIMITED_PLAIN') {
      return { status: 429, headers: h['x-mock-retry-after'] ? { 'Retry-After': h['x-mock-retry-after'] } : {}, body: { error: 'Rate limit exceeded. Max 60 requests per hour.' } };
    }
    const key = h['idempotency-key'] ?? body.idempotency_key ?? null;
    if (key && state.idem.has(key)) {
      const prev = state.idem.get(key);
      // Mock behaviour (server-side semantics of a reused key with a different body are not documented): reject it.
      if (prev.canon !== canonicalJson(body)) return { status: 400, headers: {}, body: { synthetic: true, ok: false, error: { code: 'INVALID_PARAMS', message: 'Idempotency-Key reused with a different request body (mock behaviour; undocumented upstream)' }, trace_id: 'tr_mock_idem', support_id: null } };
      return prev.response; // same billing task: replay, no new charge
    }
    const c = await executeCore(body, { simulate: h['x-mock-simulate'], cached: h['x-mock-cached'] === '1', mapVersion: h['x-mock-map-version'] });
    const env = envelopeFor(body, c);
    let response;
    if (c.out.ok) {
      const { billing, synthetic, ...result } = env;
      const top = { credits_charged: c.charged, charged: c.charged, charge_unit: 'credit', balance_remaining: state.balance, support_id: c.receipt };
      response = { status: 200, headers: {}, body: billingStyle === 'block' ? { synthetic: true, ok: true, result, billing } : { synthetic: true, ok: true, result, ...top } };
    } else {
      const status = ERROR_CODES[c.out.code]?.http ?? 400;
      const headers = c.out.code === 'RATE_LIMITED' && h['x-mock-retry-after'] ? { 'Retry-After': h['x-mock-retry-after'] } : {};
      response = { status, headers, body: { synthetic: true, ok: false, error: env.error, trace_id: c.trace, support_id: c.receipt } };
    }
    if (key && c.out.ok) state.idem.set(key, { canon: canonicalJson(body), response }); // only successes are replayed; a failed attempt can be retried
    return response;
  }

  /** MCP lane (in-process): returns the envelope directly, as documented for MCP. */
  async function handleMcp(args) {
    const c = await executeCore(args, {});
    return envelopeFor(args, c);
  }

  function mapListing() {
    const p = (names) => Object.fromEntries(names.map((n) => [n, { type: 'string', required: n !== 'count' }]));
    const actions = EXISTING.map((name) => ({ name, description: 'existing action (mock listing)', params: name.startsWith('list_profile_posts') ? p(name.endsWith('_next') ? ['profile_id', 'pagination_token', 'count'] : ['profile_id', 'count']) : {} }));
    if (!o.searchMissing) {
      actions.push({ name: 'search_posts', description: 'PROPOSED (mock)', params: { keywords: { required: true }, sort: {}, date_posted: {}, count: {} } });
      actions.push({ name: 'search_posts_next', description: 'PROPOSED (mock)', params: { keywords: { required: true }, sort: {}, date_posted: {}, pagination_token: { required: true }, count: {} } });
    }
    return { synthetic: true, domain: 'linkedin.com', version: mapVersion, actions };
  }

  return { handleRest, handleMcp, mapListing, state };
}

/** HTTP wrapper. */
export function createMockServer(o = {}) {
  const core = createMockCore(o);
  const server = createServer(async (req, res) => {
    const send = (status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    try {
      const url = new URL(req.url, 'http://mock');
      if (req.method === 'GET' && url.pathname === '/health') return send(200, { status: 'ok', version: 'mock', synthetic: true });
      if (req.method === 'GET' && url.pathname === '/api/sites/linkedin.com') return send(200, core.mapListing());
      if (req.method === 'POST' && url.pathname === '/api/execute') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body = null;
        try { body = JSON.parse(raw); } catch { body = null; }
        const r = await core.handleRest({ headers: req.headers, body });
        return send(r.status, r.body, r.headers);
      }
      return send(404, { error: 'not found (mock)' });
    } catch (e) {
      return send(500, { error: `mock failure: ${e?.message ?? e}` });
    }
  });
  return {
    core,
    server,
    /** @returns {Promise<string>} base URL */
    listen(port = 0) { return new Promise((r) => server.listen(port, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`))); },
    close() { return new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const port = Number(args[args.indexOf('--port') + 1] ?? 0) || 8787;
  const m = createMockServer({ searchMissing: args.includes('--search-missing'), billingStyle: args.includes('--billing-block') ? 'block' : 'top' });
  const url = await m.listen(port);
  console.log(`[SYNTHETIC] mock AgentWeb execute server on ${url} (search_posts ${args.includes('--search-missing') ? 'MISSING, as today' : 'present (mock)'}). Ctrl-C to stop.`);
}
