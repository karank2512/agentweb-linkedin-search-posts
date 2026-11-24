import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance } from '../conformance/checks.js';
import { parseArgs, resolveTarget } from '../conformance/run.js';
import { createMockServer, createMockCore } from '../demo/mock-server.js';
import { createSearchPostsHandler, makeCursorCodec, unavailableSource } from '../src/reference-handler.js';
import { createClient } from '../src/client.js';
import { searchPosts } from '../src/search.js';
import { UpstreamError } from '../src/errors.js';
import { FIXED_NOW } from './helpers.js';

async function conformance(opts) {
  const m = createMockServer({ now: () => FIXED_NOW, ...opts });
  const baseUrl = await m.listen(0);
  try { return await runConformance({ baseUrl, apiKey: 'aw_t', fetch, keyPrefix: 'test' }); } finally { await m.close(); }
}
const status = (out, id) => out.results.find((r) => r.id === id).status;

test('conformance kit: every check passes against the mock with search_posts (mock)', async () => {
  const out = await conformance({});
  assert.deepEqual(out.totals, { pass: 26, fail: 0, blocked: 0, inconclusive: 0, total: 26 });
});

test('conformance kit: mock in today\'s state → A0 blocked, everything else blocked', async () => {
  const out = await conformance({ searchMissing: true });
  assert.equal(status(out, 'A0'), 'blocked');
  assert.equal(out.totals.blocked, 26);
});

test('conformance kit catches an unbound cursor, a looping token and duplicate rows', async () => {
  assert.equal(status(await conformance({ faults: { unboundCursor: true } }), 'C2'), 'fail');
  assert.equal(status(await conformance({ faults: { loopingToken: true } }), 'C4'), 'fail');
  const d = await conformance({ faults: { duplicateRows: true } });
  assert.equal(status(d, 'D1'), 'fail');
});

test('conformance kit with billing-block responses and an unmetered account: B2/I1 inconclusive, not faked', async () => {
  const out = await conformance({ billingStyle: 'block', startingBalance: null });
  assert.equal(status(out, 'B1'), 'pass');
  assert.equal(status(out, 'B2'), 'inconclusive');
  assert.equal(status(out, 'I1'), 'inconclusive');
});

test('live mode is refused without every safeguard; non-local URLs refused without --live', () => {
  const env = { AGENTWEB_API_KEY: 'aw_x' };
  assert.throws(() => resolveTarget(parseArgs(['--live']), env), /base-url/);
  assert.throws(() => resolveTarget(parseArgs(['--live', '--base-url', 'https://mcp.agentweb.us']), env), /i-accept/);
  assert.throws(() => resolveTarget(parseArgs(['--live', '--base-url', 'https://mcp.agentweb.us', '--i-accept-live-calls-and-charges']), {}), /AGENTWEB_API_KEY/);
  assert.throws(() => resolveTarget(parseArgs(['--base-url', 'https://mcp.agentweb.us']), env), /local mock/);
  assert.equal(resolveTarget(parseArgs([]), {}).kind, 'in-process-mock');
  assert.equal(resolveTarget(parseArgs(['--base-url', 'http://127.0.0.1:9']), {}).kind, 'local-url');
});

test('reference handler: tampered or foreign cursors are rejected', async () => {
  const h = createSearchPostsHandler({ source: { fetchPage: async () => ({ rows: [], nextOffset: null }) }, cursorSecret: 's' });
  const other = makeCursorCodec('different-secret').encode('fp', 5);
  await assert.rejects(h('search_posts_next', { keywords: 'x', pagination_token: other }), { code: 'INVALID_PARAMS' });
  await assert.rejects(h('search_posts_next', { keywords: 'x', pagination_token: 'abc.def' }), { code: 'INVALID_PARAMS' });
});

test('reference handler with the unavailable source (stand-in for the AgentWeb-owned piece) → UPSTREAM_ERROR naming the gap', async () => {
  const h = createSearchPostsHandler({ source: unavailableSource, cursorSecret: 's' });
  await assert.rejects(h('search_posts', { keywords: 'x' }), (e) => e instanceof UpstreamError && /AgentWeb-owned/.test(e.message));
});

test('mock: same Idempotency-Key replays the stored response and does not charge again', async () => {
  const core = createMockCore({});
  const req = (key) => core.handleRest({ headers: { authorization: 'Bearer aw_t', 'idempotency-key': key }, body: { domain: 'linkedin.com', action: 'search_posts', params: { keywords: 'hiring', count: 1 } } });
  const a = await req('k');
  const b = await req('k');
  assert.deepEqual(a, b);
  assert.equal(core.state.balance, 999);
  await req('k2');
  assert.equal(core.state.balance, 998);
});

test('REST and MCP lanes give the same normalised posts (mock)', async () => {
  const core = createMockCore({ now: () => FIXED_NOW });
  const rest = createClient({ fetch: async (_u, init) => { const r = await core.handleRest({ headers: { authorization: 'Bearer aw_t' }, body: JSON.parse(init.body) }); return new Response(JSON.stringify(r.body), { status: r.status }); } });
  const mcp = createClient({ mcpCall: async (_t, args) => ({ content: [{ type: 'text', text: JSON.stringify(await core.handleMcp(args)) }] }) });
  const q = { keywords: 'hiring', count: 5 };
  const a = await searchPosts({ client: rest, params: q, maxPages: 2, now: FIXED_NOW });
  const b = await searchPosts({ client: mcp, params: q, maxPages: 2, now: FIXED_NOW });
  assert.deepEqual(a.posts, b.posts);
  assert.equal(a.posts.length, 10);
});

test('conformance kit on a live target: reaching the page cap with a fresh token is inconclusive, not fail', async () => {
  const m = createMockServer({ now: () => FIXED_NOW });
  const baseUrl = await m.listen(0);
  try {
    const out = await runConformance({ baseUrl, apiKey: 'aw_t', fetch, keyPrefix: 'cap', maxPages: 2, live: true });
    assert.equal(status(out, 'C4'), 'inconclusive');
    assert.match(out.results.find((r) => r.id === 'C4').detail, /termination not observed/);
  } finally { await m.close(); }
});

test('live mode refuses http:// and non-standard hosts', () => {
  const env = { AGENTWEB_API_KEY: 'aw_x' };
  const live = (u, extra = []) => resolveTarget(parseArgs(['--live', '--base-url', u, '--i-accept-live-calls-and-charges', ...extra]), env);
  assert.throws(() => live('http://mcp.agentweb.us'), /non-https/);
  assert.throws(() => live('https://evil.example'), /only targets/);
  assert.equal(live('https://mcp.agentweb.us').kind, 'live');
  assert.equal(live('https://staging.example', ['--allow-nonstandard-live-host']).kind, 'live');
});
