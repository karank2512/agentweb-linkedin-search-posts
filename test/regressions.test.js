// Regression tests: live-host guard, plain 403, "not cached",
// array-form params in the probe, account-level stops in the watchlist filter, MCP page clamp, key redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.js';
import { TraceLedger } from '../src/ledger.js';
import { probeSearchPosts } from '../src/probe.js';
import { watchlistFilter } from '../src/sources/watchlist.js';
import { linkedinSearchPostsTool, createLinkedinSearchPostsHandler } from '../src/mcp-tool.js';
import { restErr, restOk, row, scriptedFetch } from './helpers.js';

const REQ = { domain: 'linkedin.com', action: 'search_posts', params: { keywords: 'k' } };

test('client refuses a non-loopback baseUrl unless allowLive is explicit', () => {
  const f = scriptedFetch([]);
  assert.throws(() => createClient({ baseUrl: 'https://mcp.agentweb.us', apiKey: 'aw_t', fetch: f }), /allowLive/);
  assert.throws(() => createClient({ baseUrl: 'http://example.com', apiKey: 'aw_t', fetch: f }), /allowLive/);
  assert.equal(createClient({ baseUrl: 'https://mcp.agentweb.us', apiKey: 'aw_t', fetch: f, allowLive: true }).baseUrl, 'https://mcp.agentweb.us');
  assert.equal(createClient({ fetch: f }).baseUrl, 'http://localhost');
});

test('plain {error} body on 403 becomes FORBIDDEN, not UNKNOWN', async () => {
  const c = createClient({ fetch: scriptedFetch([() => ({ status: 403, body: { error: 'Forbidden.' } })]) });
  await assert.rejects(c.execute(REQ), (e) => e.code === 'FORBIDDEN' && e.codeInferredFromStatus === true);
});

test('"not cached" notes are not reported as cached', async () => {
  const c = createClient({ fetch: scriptedFetch([() => restOk({ posts: [] }, { notes: ['live read, not cached'] }), () => restOk({ posts: [] }, { notes: ['cached copy'] })]) });
  assert.equal((await c.execute(REQ)).cached, false);
  assert.equal((await c.execute(REQ)).cached, true);
});

test('the API key never appears in ledger lines or error JSON', async () => {
  const ledger = new TraceLedger();
  const secret = 'aw_SECRET_should_not_leak_123';
  const c = createClient({ apiKey: secret, fetch: scriptedFetch([() => restOk({ posts: [] }), () => restErr('AUTH_REQUIRED', 403)]), ledger });
  await c.execute(REQ);
  const err = await c.execute(REQ).catch((e) => e);
  const dump = JSON.stringify({ ledger: ledger.toJSON?.() ?? ledger, err: err.toJSON?.() ?? String(err), msg: err.message });
  assert.ok(!dump.includes(secret));
});

test('probe handles params given as an array of {name, required}', () => {
  const map = { version: 'x', actions: [
    { name: 'search_posts', params: [{ name: 'keywords', required: true }, { name: 'sort' }, { name: 'date_posted' }, { name: 'count' }] },
    { name: 'search_posts_next', params: [{ name: 'keywords', required: true }, { name: 'pagination_token', required: true }, { name: 'count' }] },
  ] };
  const p = probeSearchPosts(map);
  assert.equal(p.status, 'supported', p.problems.join('; '));
});

test('watchlist filter stops at an account-level error instead of repeating it for every profile', async () => {
  const f = scriptedFetch(() => restErr('AUTH_REQUIRED', 403));
  const r = await watchlistFilter({ client: createClient({ fetch: f }), profileIds: ['ACoAAone', 'ACoAAtwo', 'ACoAAthree'], keywords: 'hiring' });
  assert.equal(f.calls.length, 1);
  assert.equal(r.stopped_early, 'AUTH_REQUIRED');
  assert.deepEqual(r.profiles_not_reached, ['ACoAAtwo', 'ACoAAthree']);
});

test('watchlist filter: a non-numeric count falls back to 20; a budget stop lists unreached profiles', async () => {
  const f = scriptedFetch(() => restOk({ posts: [row(1)], next_token: null }, { action: 'list_profile_posts' }));
  const r = await watchlistFilter({ client: createClient({ fetch: f }), profileIds: ['ACoAAone', 'ACoAAtwo'], keywords: 'hiring', count: 'lots', maxCredits: 1 });
  assert.equal(f.calls[0].body.params.count, 20);
  assert.equal(r.stopped_early, 'budget');
  assert.ok(r.profiles_not_reached.includes('ACoAAtwo'));
});

test('MCP tool: no idempotentHint, billing disclosed, max_pages clamped and budget defaults to the page count', async () => {
  assert.equal('idempotentHint' in linkedinSearchPostsTool.annotations, false);
  assert.match(linkedinSearchPostsTool.description, /bill/);
  assert.match(linkedinSearchPostsTool.description, /estimate/);
  let n = 0;
  const f = scriptedFetch(() => { n += 1; return restOk({ posts: [row(n)], next_token: `t${n}` }); });
  const h = createLinkedinSearchPostsHandler({ client: createClient({ fetch: f }) });
  const out = await h({ keywords: 'hiring', max_pages: 999 });
  assert.equal(f.calls.length, 10);
  assert.equal(out.structuredContent.stop_reason !== undefined, true);
});

test('an unlabelled /feed/update/urn:li: permalink from upstream is treated as constructed, not a share URL', async () => {
  const { normalizeRow } = await import('../src/normalize.js');
  const p = normalizeRow({ activity_urn: 'urn:li:activity:1', permalink: 'https://www.linkedin.com/feed/update/urn:li:activity:1/', text: 't' });
  assert.equal(p.permalink_source, 'constructed_from_urn');
  assert.equal(p.permalink_constructed, true);
});

test('conformance runner rejects an invalid --max-pages', async () => {
  const { parseArgs, resolveTarget } = await import('../conformance/run.js');
  for (const v of ['abc', '0', '1', '-3', '2.5', '999']) assert.throws(() => resolveTarget(parseArgs(['--max-pages', v]), {}), /--max-pages/);
  assert.equal(resolveTarget(parseArgs(['--max-pages', '4']), {}).kind, 'in-process-mock');
});

test('Retry-After as an HTTP date in the future beyond the limit is not waited out; unparseable is not waited out', async () => {
  const { walkPages } = await import('../src/paginate.js');
  for (const ra of [new Date(Date.now() + 3_600_000).toUTCString(), 'soon-ish']) {
    let slept = 0;
    const c = createClient({ fetch: scriptedFetch([() => restErr('RATE_LIMITED', 429, { headers: { 'retry-after': ra } })]) });
    const r = await walkPages({ client: c, domain: 'linkedin.com', first: { action: 'search_posts', params: { keywords: 'k' } }, next: () => ({}), retries: 1, maxRetryWaitMs: 1000, sleep: async (ms) => { slept += ms; } });
    assert.equal(slept, 0);
    assert.ok(r.warnings.some((w) => w.type === 'retry_wait_exceeds_limit'));
  }
});

test('MCP max_pages 0 clamps to 1', async () => {
  const f = scriptedFetch(() => restOk({ posts: [row(1)], next_token: 't' }));
  await createLinkedinSearchPostsHandler({ client: createClient({ fetch: f }) })({ keywords: 'hiring', max_pages: 0 });
  assert.equal(f.calls.length, 1);
});
