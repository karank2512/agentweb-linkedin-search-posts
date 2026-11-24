import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, parseExecuteResponse, unwrapMcpResult } from '../src/client.js';
import * as E from '../src/errors.js';
import { TraceLedger } from '../src/ledger.js';
import { restErr, restOk, scriptedFetch } from './helpers.js';

const REQ = { domain: 'linkedin.com', action: 'search_posts', params: { keywords: 'hiring' } };
const parse = (body, status = 200, headers = null) => parseExecuteResponse({ body, status, headers: headers ? new Headers(headers) : null, domain: 'linkedin.com', action: 'search_posts', lane: 'rest' });
const catchErr = (fn) => { try { fn(); } catch (e) { return e; } assert.fail('expected a throw'); };

test('REST success, OpenAPI shape (top-level charged/credits_charged/charge_unit/support_id)', () => {
  const r = parse(restOk({ posts: [], next_token: null }, { receipt: 'awr_A', balance: 42 }).body);
  assert.equal(r.ok, true);
  assert.equal(r.billing.credits, 1);
  assert.equal(r.billing.chargeUnit, 'credit');
  assert.equal(r.billing.balanceRemaining, 42);
  assert.equal(r.billing.supportId, 'awr_A');
  assert.equal(r.billing.receiptId, 'awr_A');
  assert.equal(r.billing.shape, 'top-level');
  assert.equal(r.mapVersion, '0.7.2');
  assert.deepEqual(r.value, { posts: [], next_token: null });
});

test('REST success, prose-doc shape (billing block) and null balance', () => {
  const body = { ok: true, result: { success: true, data: { kind: 'json', value: { a: 1 } }, duration_ms: 5, map_version: '1' }, billing: { credits_charged: 1, balance_remaining: null, receipt_id: 'awr_B', policy: 'p' } };
  const r = parse(body);
  assert.equal(r.billing.shape, 'billing-block');
  assert.equal(r.billing.receiptId, 'awr_B');
  assert.equal(r.billing.balanceRemaining, null);
  assert.equal(r.billing.balanceReported, true);
  assert.equal(r.billing.policy, 'p');
});

test('credits are never invented: absent charge → null', () => {
  const r = parse({ ok: true, result: { success: true, data: { kind: 'json', value: 1 } } });
  assert.equal(r.billing.credits, null);
  assert.equal(r.billing.balanceReported, false);
  assert.equal(r.billing.shape, 'none');
});

test('MCP envelope parsed directly, from text content and from structuredContent', () => {
  const env = { success: true, domain: 'linkedin.com', action: 'search_posts', data: { kind: 'json', value: { x: 1 } }, duration_ms: 9, map_version: '0.7.2', billing: { credits_charged: 1, balance_remaining: 7, receipt_id: 'awr_M', policy: 'p' } };
  for (const wrapped of [env, { content: [{ type: 'text', text: JSON.stringify(env) }] }, { structuredContent: env, content: [] }]) {
    const r = parseExecuteResponse({ body: unwrapMcpResult(wrapped), domain: 'linkedin.com', action: 'search_posts', lane: 'mcp' });
    assert.equal(r.billing.receiptId, 'awr_M');
    assert.deepEqual(r.value, { x: 1 });
    assert.equal(r.durationMs, 9);
  }
});

test('every documented error code maps to its typed error; trace_id and support_id preserved', () => {
  for (const [code, { cls, http }] of Object.entries(E.ERROR_CODES)) {
    const e = catchErr(() => parse(restErr(code, http ?? 400, { trace: `tr_${code}`, support: `awr_${code}` }).body, http ?? 400));
    assert.ok(e instanceof cls, `${code} → ${cls.name}`);
    assert.ok(e instanceof E.AgentWebError);
    assert.equal(e.code, code);
    assert.equal(e.traceId, `tr_${code}`);
    assert.equal(e.supportId, `awr_${code}`);
    assert.equal(e.httpStatus, http ?? 400);
  }
});

test('the documented REST error table is fully covered', () => {
  const table = ['INVALID_PARAMS', 'INSUFFICIENT_CREDITS', 'PAYMENT_DECLINED', 'BILLING_ACCOUNT_RESTRICTED', 'AUTH_REQUIRED', 'AUTH_MISCONFIGURED', 'MAP_NOT_FOUND', 'ACTION_NOT_FOUND', 'RATE_LIMITED', 'PAYMENT_NOT_SUPPORTED', 'UPSTREAM_ERROR', 'UPSTREAM_APP_ERROR', 'PARSE_ERROR', 'CURATED_MAP_STALE', 'BILLING_UNAVAILABLE', 'TIMEOUT'];
  for (const c of table) assert.ok(E.ERROR_CODES[c], c);
});

test('unknown code → generic AgentWebError (open-ended enum)', () => {
  const e = catchErr(() => parse(restErr('SOMETHING_NEW', 500).body, 500));
  assert.equal(e.constructor, E.AgentWebError);
  assert.equal(e.code, 'SOMETHING_NEW');
});

test('ACTION_NOT_FOUND → UnsupportedActionError naming linkedin.com/search_posts', () => {
  const e = catchErr(() => parse(restErr('ACTION_NOT_FOUND', 404, { message: 'Action "search_posts" not found on linkedin.com. Available actions: ...' }).body, 404));
  assert.ok(e instanceof E.UnsupportedActionError);
  assert.equal(e.target, 'linkedin.com/search_posts');
  assert.match(e.message, /linkedin\.com\/search_posts/);
});

test('AUTH_REQUIRED keeps error.auth; INSUFFICIENT_CREDITS keeps error.credits; delegation codes keep error.delegation', () => {
  const a = catchErr(() => parse(restErr('AUTH_REQUIRED', 403, { extra: { auth: { provider: 'linkedin', connect_url: 'u' } } }).body, 403));
  assert.deepEqual(a.auth, { provider: 'linkedin', connect_url: 'u' });
  const c = catchErr(() => parse(restErr('INSUFFICIENT_CREDITS', 402, { extra: { credits: { top_up: 'x' } } }).body, 402));
  assert.deepEqual(c.credits, { top_up: 'x' });
  const d = catchErr(() => parse(restErr('APPROVAL_PENDING', 403, { extra: { delegation: { member: 'm' } } }).body, 403));
  assert.ok(d instanceof E.DelegationError);
  assert.deepEqual(d.delegation, { member: 'm' });
});

test('RATE_LIMITED keeps the Retry-After header verbatim and never invents one', () => {
  const withHdr = catchErr(() => parse(restErr('RATE_LIMITED', 429).body, 429, { 'Retry-After': '30' }));
  assert.ok(withHdr instanceof E.RateLimitedError);
  assert.equal(withHdr.retryAfter, '30');
  assert.match(withHdr.message, /RATE_LIMITED/);
  const without = catchErr(() => parse(restErr('RATE_LIMITED', 429).body, 429));
  assert.equal(without.retryAfter, null);
});

test('plain ErrorResponse {error:"..."} on 429 → RateLimitedError (code inferred from status, flagged); on 401 → UnauthorizedError', () => {
  const r = catchErr(() => parse({ error: 'Rate limit exceeded. Max 60 requests per hour.' }, 429, { 'Retry-After': '120' }));
  assert.ok(r instanceof E.RateLimitedError);
  assert.equal(r.codeInferredFromStatus, true);
  assert.equal(r.retryAfter, '120');
  const u = catchErr(() => parse({ error: 'Missing or invalid authorization.' }, 401));
  assert.ok(u instanceof E.UnauthorizedError);
});

test('MCP failure with a receipt, 0 credits and data null', () => {
  const env = { success: false, domain: 'linkedin.com', action: 'search_posts', data: null, error: { code: 'ACTION_NOT_FOUND', message: 'nope' }, duration_ms: 3, map_version: '0.7.2', trace_id: 'tr_x', billing: { credits_charged: 0, balance_remaining: 10, receipt_id: 'awr_refund', policy: 'p' } };
  const e = catchErr(() => parseExecuteResponse({ body: env, domain: 'linkedin.com', action: 'search_posts', lane: 'mcp' }));
  assert.ok(e instanceof E.UnsupportedActionError);
  assert.equal(e.traceId, 'tr_x');
  assert.equal(e.receiptId, 'awr_refund');
  assert.equal(e.billing.credits, 0);
});

test('ok:true but result.success:false is treated as a failure', () => {
  const e = catchErr(() => parse({ ok: true, result: { success: false, error: { code: 'PARSE_ERROR', message: 'bad payload' } } }));
  assert.ok(e instanceof E.ParseError);
});

test('unreadable responses → TransportError', () => {
  assert.ok(catchErr(() => parse(null, 502)) instanceof E.TransportError);
  assert.ok(catchErr(() => parse({ hello: 1 })) instanceof E.TransportError);
});

test('client sends Idempotency-Key, Authorization and fresh; parses notes "cached"', async () => {
  const f = scriptedFetch([() => restOk({ posts: [] }, { notes: ['cached copy from 2026-11-24'] })]);
  const c = createClient({ baseUrl: 'http://localhost/', apiKey: 'aw_t', fetch: f });
  const r = await c.execute(REQ, { idempotencyKey: 'k1', fresh: true });
  assert.equal(f.calls[0].url, 'http://localhost/api/execute');
  assert.equal(f.calls[0].headers['idempotency-key'], 'k1');
  assert.equal(f.calls[0].headers.authorization, 'Bearer aw_t');
  assert.equal(f.calls[0].body.fresh, true);
  assert.equal(r.cached, true);
  assert.deepEqual(r.notes, ['cached copy from 2026-11-24']);
});

test('fresh is omitted unless set; notes without "cached" → live', async () => {
  const f = scriptedFetch([() => restOk({}, { notes: 'live read' })]);
  const r = await createClient({ fetch: f }).execute(REQ);
  assert.equal('fresh' in f.calls[0].body, false);
  assert.equal(r.cached, false);
});

test('same Idempotency-Key with the same body is allowed (a retry); with different params it throws before any request', async () => {
  const f = scriptedFetch(() => restOk({}));
  const c = createClient({ fetch: f });
  await c.execute(REQ, { idempotencyKey: 'k' });
  await c.execute(REQ, { idempotencyKey: 'k' });
  await assert.rejects(c.execute({ ...REQ, params: { keywords: 'other' } }, { idempotencyKey: 'k' }), E.IdempotencyKeyConflictError);
  assert.equal(f.calls.length, 2);
  await assert.rejects(c.execute(REQ, { idempotencyKey: 'k', fresh: true }), E.IdempotencyKeyConflictError);
});

test('client rejects non-scalar params locally and requires an injected fetch', async () => {
  const c = createClient({ fetch: scriptedFetch([]) });
  await assert.rejects(c.execute({ ...REQ, params: { keywords: ['a'] } }), E.InvalidParamsError);
  assert.throws(() => createClient({}), /inject a fetch/);
});

test('network failure → TransportError; ledger records it', async () => {
  const ledger = new TraceLedger();
  const c = createClient({ fetch: async () => { throw new Error('ECONNREFUSED'); }, ledger });
  await assert.rejects(c.execute(REQ), E.TransportError);
  assert.equal(ledger.entries.length, 1);
  assert.equal(ledger.entries[0].ok, false);
});

test('MCP lane: calls the execute tool, warns that idempotency/fresh cannot be sent', async () => {
  const seen = [];
  const c = createClient({ mcpCall: async (tool, args) => { seen.push([tool, args]); return { success: true, data: { kind: 'json', value: 1 }, billing: { credits_charged: 1, receipt_id: 'awr_m' } }; } });
  const r = await c.execute(REQ, { idempotencyKey: 'k', fresh: true });
  assert.deepEqual(seen[0], ['execute', REQ]);
  assert.equal(r.lane, 'mcp');
  assert.equal(r.warnings.length, 2);
});

test('ledger: one entry per call with receipt, trace, map_version, duration, credits, cached', async () => {
  const ledger = new TraceLedger();
  const f = scriptedFetch([() => restOk({}, { receipt: 'awr_1', notes: 'cached' }), () => restErr('TIMEOUT', 504, { trace: 'tr_2', support: 'awr_2' }), () => ({ status: 200, body: { ok: true, result: { success: true, data: { kind: 'json', value: 1 } } } })]);
  const c = createClient({ fetch: f, ledger });
  await c.execute(REQ, { meta: { page: 1 } });
  await assert.rejects(c.execute(REQ));
  await c.execute(REQ);
  const [a, b, d] = ledger.entries;
  assert.deepEqual([a.receipt_id, a.map_version, a.duration_ms, a.credits, a.cached, a.meta.page], ['awr_1', '0.7.2', 100, 1, true, 1]);
  assert.deepEqual([b.ok, b.code, b.trace_id, b.support_id, b.http_status], [false, 'TIMEOUT', 'tr_2', 'awr_2', 504]);
  assert.equal(d.credits, null);
  const t = ledger.totals();
  assert.equal(t.calls, 3);
  assert.equal(t.credits_reported, 1);
  assert.equal(t.calls_without_reported_charge, 2);
  assert.deepEqual(t.receipt_ids, ['awr_1', 'awr_2']);
  assert.equal(ledger.toLines().length, 4);
});
