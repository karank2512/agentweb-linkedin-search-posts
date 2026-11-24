import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../src/client.js';
import { TraceLedger } from '../src/ledger.js';
import { extractPage, walkPages } from '../src/paginate.js';
import { searchPosts } from '../src/search.js';
import { CuratedMapStaleError, InsufficientCreditsError, UnsupportedActionError } from '../src/errors.js';
import { restErr, restOk, row, scriptedFetch } from './helpers.js';

const page = (ids, next, o) => restOk({ posts: ids.map((i) => row(i)), next_token: next }, o);
const setup = (script) => {
  const f = scriptedFetch(script);
  const ledger = new TraceLedger();
  return { f, ledger, client: createClient({ fetch: f, ledger }) };
};
const walk = (client, o = {}) => walkPages({
  client, domain: 'linkedin.com', walkId: 'w',
  first: { action: 'search_posts', params: { keywords: 'k', count: 2 } },
  next: (t) => ({ action: 'search_posts_next', params: { keywords: 'k', count: 2, pagination_token: t } }),
  sleep: async () => {}, ...o,
});

test('next_token round trip: token passed unchanged to _next; null ends the walk', async () => {
  const { f, client } = setup([() => page([1, 2], 'T/1+=='), () => page([3], null)]);
  const r = await walk(client);
  assert.equal(f.calls[1].body.action, 'search_posts_next');
  assert.equal(f.calls[1].body.params.pagination_token, 'T/1+==');
  assert.equal(r.stopReason, 'end_of_results');
  assert.equal(r.complete, true);
  assert.equal(r.rows.length, 3);
});

test('max-pages guard', async () => {
  const { f, client } = setup((req) => page([req.n * 10], `t${req.n}`));
  const r = await walk(client, { maxPages: 3 });
  assert.equal(f.calls.length, 3);
  assert.equal(r.stopReason, 'max_pages');
  assert.equal(r.complete, false);
});

test('a repeated token (loop) ends the walk', async () => {
  const { f, client } = setup([() => page([1], 'A'), () => page([2], 'B'), () => page([3], 'A')]);
  const r = await walk(client, { maxPages: 10 });
  assert.equal(f.calls.length, 3);
  assert.equal(r.stopReason, 'repeated_token');
  assert.ok(r.warnings.some((w) => w.type === 'repeated_token'));
});

test('an empty page with a non-null token continues, then stops after maxEmptyPages', async () => {
  const one = setup([() => page([], 'A'), () => page([1], null)]);
  const r1 = await walk(one.client);
  assert.equal(r1.stopReason, 'end_of_results');
  assert.equal(r1.rows.length, 1);
  assert.ok(r1.warnings.some((w) => w.type === 'empty_page_with_token'));
  const two = setup([() => page([], 'A'), () => page([], 'B'), () => page([1], null)]);
  const r2 = await walk(two.client, { maxEmptyPages: 2 });
  assert.equal(r2.stopReason, 'empty_pages');
  assert.equal(two.f.calls.length, 2);
});

test('map_version change mid-walk is flagged (and can stop the walk)', async () => {
  const s = () => [() => page([1], 'A', { map_version: '0.7.2' }), () => page([2], 'B', { map_version: '0.7.3' }), () => page([3], null, { map_version: '0.7.3' })];
  const r = await walk(setup(s()).client);
  assert.deepEqual(r.warnings.find((w) => w.type === 'map_version_changed'), { type: 'map_version_changed', page: 2, from: '0.7.2', to: '0.7.3' });
  assert.equal(r.rows[1].mapVersion, '0.7.3');
  assert.equal(r.complete, true);
  const stop = await walk(setup(s()).client, { stopOnMapVersionChange: true });
  assert.equal(stop.stopReason, 'map_version_changed');
  assert.equal(stop.rows.length, 2);
});

test('partial failure on page N returns rows so far, receipts and the error (no throw)', async () => {
  const { client, ledger } = setup([() => page([1, 2], 'A', { receipt: 'awr_p1' }), () => page([3, 4], 'B', { receipt: 'awr_p2' }), () => restErr('UPSTREAM_ERROR', 502, { trace: 'tr_p3', support: 'awr_p3' })]);
  const r = await walk(client, { maxPages: 5 });
  assert.equal(r.stopReason, 'error');
  assert.equal(r.rows.length, 4);
  assert.equal(r.error.code, 'UPSTREAM_ERROR');
  assert.equal(r.error.traceId, 'tr_p3');
  assert.deepEqual(ledger.totals().receipt_ids, ['awr_p1', 'awr_p2', 'awr_p3']);
  assert.equal(r.creditsReported, 2);
});

test('CURATED_MAP_STALE mid-walk → typed error, partial rows kept', async () => {
  const { client } = setup([() => page([1], 'A'), () => restErr('CURATED_MAP_STALE', 502)]);
  const r = await walk(client);
  assert.ok(r.error instanceof CuratedMapStaleError);
  assert.equal(r.rows.length, 1);
});

test('cached pages are flagged', async () => {
  const { client } = setup([() => page([1], null, { notes: ['cached'] })]);
  const r = await walk(client);
  assert.equal(r.pages[0].cached, true);
  assert.ok(r.warnings.some((w) => w.type === 'cached_page'));
});

test('credit budget guard stops before a call that would exceed it', async () => {
  const { f, client } = setup((req) => page([req.n], `t${req.n}`));
  const r = await walk(client, { maxPages: 10, maxCredits: 3 });
  assert.equal(f.calls.length, 3);
  assert.equal(r.stopReason, 'budget');
  assert.equal(r.error.code, 'CLIENT_BUDGET');
  assert.equal(r.creditsReported, 3);
});

test('unreported credits are counted as the documented ~1 estimate for the budget only, and flagged', async () => {
  const noCharge = (v) => ({ status: 200, body: { ok: true, result: { success: true, data: { kind: 'json', value: v } } } });
  const { f, client } = setup([() => noCharge({ posts: [row(1)], next_token: 'A' }), () => noCharge({ posts: [row(2)], next_token: 'B' })]);
  const r = await walk(client, { maxCredits: 2, maxPages: 5 });
  assert.equal(f.calls.length, 2);
  assert.equal(r.stopReason, 'budget');
  assert.equal(r.creditsReported, 0);
  assert.equal(r.warnings.filter((w) => w.type === 'credits_not_reported').length, 2);
});

test('idempotency: distinct keys per page; a retry of the same page reuses its key; Retry-After drives the wait', async () => {
  const waits = [];
  const { f, client, ledger } = setup([() => page([1], 'A'), () => restErr('RATE_LIMITED', 429, { headers: { 'Retry-After': '2' } }), () => page([2], null)]);
  const r = await walk(client, { retries: 1, sleep: async (ms) => { waits.push(ms); } });
  const keys = f.calls.map((c) => c.headers['idempotency-key']);
  assert.deepEqual(keys, ['w:search_posts:p1', 'w:search_posts_next:p2', 'w:search_posts_next:p2']);
  assert.deepEqual(waits, [2000]);
  assert.equal(r.complete, true);
  assert.equal(ledger.entries.length, 3);
});

test('no Retry-After → the caller-chosen delay (default 0), never an invented one', async () => {
  const waits = [];
  const { client } = setup([() => restErr('TIMEOUT', 504), () => page([1], null)]);
  await walk(client, { retries: 1, sleep: async (ms) => { waits.push(ms); } });
  assert.deepEqual(waits, [0]);
});

test('non-transient errors are not retried', async () => {
  const { f, client } = setup([() => restErr('INVALID_PARAMS', 400), () => page([1], null)]);
  const r = await walk(client, { retries: 3 });
  assert.equal(f.calls.length, 1);
  assert.equal(r.error.code, 'INVALID_PARAMS');
});

test('INSUFFICIENT_CREDITS mid-walk stops with partial rows', async () => {
  const { client } = setup([() => page([1], 'A'), () => restErr('INSUFFICIENT_CREDITS', 402, { extra: { credits: { link: 'x' } } })]);
  const r = await walk(client);
  assert.ok(r.error instanceof InsufficientCreditsError);
  assert.equal(r.rows.length, 1);
});

test('extractPage accepts {posts,next_token}, a bare array with per-row next_token, and {rows}', () => {
  assert.deepEqual(extractPage({ posts: [1], next_token: 'a' }), { rows: [1], nextToken: 'a', tokenLocation: 'top-level' });
  const arr = [{ a: 1, next_token: 'b' }, { a: 2, next_token: 'b' }];
  assert.deepEqual(extractPage(arr), { rows: arr, nextToken: 'b', tokenLocation: 'row' });
  assert.equal(extractPage({ rows: [1, 2] }).rows.length, 2);
  assert.deepEqual(extractPage(null), { rows: [], nextToken: null, tokenLocation: 'none' });
});

test('searchPosts: ACTION_NOT_FOUND on page 1 yields UnsupportedActionError, no rows', async () => {
  const { client } = setup([() => restErr('ACTION_NOT_FOUND', 404)]);
  const r = await searchPosts({ client, params: { keywords: 'hiring' } });
  assert.ok(r.error instanceof UnsupportedActionError);
  assert.equal(r.posts.length, 0);
});

test('searchPosts: invalid params are rejected before any call', async () => {
  const { f, client } = setup([]);
  await assert.rejects(searchPosts({ client, params: { keywords: 'x', count: 500 } }), /<= 100/);
  assert.equal(f.calls.length, 0);
});

test('searchPosts: same URN across pages appears once', async () => {
  const { client } = setup([() => page([1, 2], 'A'), () => page([2, 3], null)]);
  const r = await searchPosts({ client, params: { keywords: 'x', count: 2 } });
  assert.deepEqual(r.posts.map((p) => p.urn), ['urn:li:activity:1', 'urn:li:activity:2', 'urn:li:activity:3']);
  assert.equal(r.duplicates_removed, 1);
});

test('a next-request builder that throws on a bad server token keeps the rows already paid for', async () => {
  const { client } = setup([() => page([1, 2], 10)]); // numeric token
  const r = await walk(client, { next: (t) => { if (typeof t !== 'string') throw new TypeError('pagination_token must be a string'); return { action: 'search_posts_next', params: { pagination_token: t } }; } });
  assert.equal(r.stopReason, 'error');
  assert.equal(r.rows.length, 2);
  assert.match(String(r.error), /pagination_token/);
});

test('searchPosts with a numeric next_token from the server returns page 1 rows, not a rejection', async () => {
  const { client } = setup([() => page([1, 2], 10)]);
  const r = await searchPosts({ client, params: { keywords: 'k', count: 2 }, maxPages: 3 });
  assert.equal(r.posts.length, 2);
  assert.equal(r.stopReason, 'error');
});

test('Retry-After longer than maxRetryWaitMs is not waited out', async () => {
  let slept = 0;
  const { client } = setup([() => restErr('RATE_LIMITED', 429, { headers: { 'retry-after': '3600' } })]);
  const r = await walk(client, { retries: 2, maxRetryWaitMs: 1000, sleep: async (ms) => { slept += ms; } });
  assert.equal(slept, 0);
  assert.equal(r.stopReason, 'error');
  assert.ok(r.warnings.some((w) => w.type === 'retry_wait_exceeds_limit'));
});

test('a page with no map_version after one that had it is not flagged as a version change', async () => {
  const { client } = setup([() => page([1], 't1', { map_version: '0.7.2' }), () => { const x = page([2], null); delete x.body.result.map_version; return x; }]);
  const r = await walk(client);
  assert.ok(!r.warnings.some((w) => w.type === 'map_version_changed'));
});
