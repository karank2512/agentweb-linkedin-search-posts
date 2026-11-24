// Black-box conformance checks for the PROPOSED linkedin.com search_posts / search_posts_next actions.
// Speaks only POST {baseUrl}/api/execute, as documented. Assumes nothing about the executor's internals.
// Every check states the requirement it tests. Results: pass | fail | blocked | inconclusive.

import { MAP_ENTRY } from '../src/contract.js';

const DOMAIN = 'linkedin.com';

/**
 * @param {{baseUrl: string, apiKey: string, fetch: typeof fetch, keywords?: string, maxPages?: number, keyPrefix?: string, live?: boolean}} o
 * Live targets: default walk cap is 4 pages (each page is a billed call); overlap between pages of a moving feed is
 * reported as inconclusive rather than fail.
 */
export async function runConformance(o) {
  const base = o.baseUrl.replace(/\/+$/, '');
  const kw = o.keywords ?? 'hiring';
  const maxPages = o.maxPages ?? (o.live ? 4 : 20);
  const live = o.live === true;
  const prefix = o.keyPrefix ?? `conf-${Date.now().toString(36)}`;
  let keySeq = 0;
  const results = [];
  const add = (id, requirement, status, detail = '') => results.push({ id, requirement, status, detail });

  async function post(action, params, { key } = {}) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}`, 'Idempotency-Key': key ?? `${prefix}-${++keySeq}` };
    const res = await o.fetch(`${base}/api/execute`, { method: 'POST', headers, body: JSON.stringify({ domain: DOMAIN, action, params }) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
  }
  const value = (r) => r.body?.result?.data?.value ?? r.body?.data?.value ?? null;
  const rows = (r) => value(r)?.posts ?? [];
  const nextTok = (r) => value(r)?.next_token ?? null;
  const ok = (r) => r.body?.ok === true || r.body?.success === true;
  const code = (r) => r.body?.error?.code ?? null;
  const balance = (r) => (r.body && 'balance_remaining' in r.body ? r.body.balance_remaining : r.body?.billing?.balance_remaining ?? null);
  const receipt = (r) => r.body?.support_id ?? r.body?.billing?.receipt_id ?? null;
  const credits = (r) => r.body?.charged ?? r.body?.credits_charged ?? r.body?.billing?.credits_charged ?? null;
  const expectInvalid = (id, req, r) => add(id, req, r.status === 400 && code(r) === 'INVALID_PARAMS' ? 'pass' : 'fail', `HTTP ${r.status}, code ${code(r)}`);
  // For requirements that are this kit's own proposal (not in AgentWeb's docs): a 200 is inconclusive, not a failure.
  const expectInvalidProposed = (id, req, r) => add(id, `${req} (proposed strictness)`, r.status === 400 && code(r) === 'INVALID_PARAMS' ? 'pass' : ok(r) ? 'inconclusive' : 'fail', `HTTP ${r.status}, code ${code(r)}`);
  const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  const ACCESS_CODES = ['AUTH_REQUIRED', 'AUTH_MISCONFIGURED', 'INSUFFICIENT_CREDITS', 'RATE_LIMITED', 'BILLING_ACCOUNT_RESTRICTED', 'BILLING_UNAVAILABLE', 'PAYMENT_DECLINED', 'USAGE_CAP_EXCEEDED', 'MEMBER_NOT_LINKED', 'APPROVAL_PENDING', 'DELEGATION_DENIED'];

  // A0: is the action there at all?
  const first = await post('search_posts', { keywords: kw, count: 5 });
  if (code(first) === 'ACTION_NOT_FOUND' || code(first) === 'MAP_NOT_FOUND') {
    add('A0', 'search_posts exists in the linkedin.com map', 'blocked', `HTTP ${first.status} ${code(first)}: ${first.body?.error?.message ?? ''}`.trim());
    for (const id of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'R1', 'R2', 'R3', 'C1', 'C2', 'C2s', 'C2d', 'C3', 'C4', 'D1', 'E1', 'B1', 'B2', 'I1']) add(id, '(not run)', 'blocked', 'search_posts not in map');
    return summarise(results);
  }
  if (!ok(first) && (first.status === 401 || first.status === 429 || (first.status === 403 && typeof first.body?.error === 'string') || ACCESS_CODES.includes(code(first)))) {
    // An account/access condition, not a conformance failure of the action.
    add('A0', 'search_posts can be called with this key and connection', 'blocked', `HTTP ${first.status} ${code(first) ?? ''}`.trim());
    return summarise(results);
  }
  add('A0', 'search_posts exists and a basic call succeeds', ok(first) ? 'pass' : 'fail', `HTTP ${first.status}${code(first) ? ` ${code(first)}` : ''}`);
  if (!ok(first)) return summarise(results);

  // ---- params ----
  const p1 = await post('search_posts', { count: 5 });
  expectInvalid('P1', 'missing keywords → 400 INVALID_PARAMS', p1);
  expectInvalidProposed('P2', 'unknown param → 400 INVALID_PARAMS', await post('search_posts', { keywords: kw, foo: 'bar' }));
  expectInvalid('P3', 'count > 100 → 400 INVALID_PARAMS', await post('search_posts', { keywords: kw, count: 101 }));
  const p4 = await post('search_posts', { keywords: kw, count: '3' });
  add('P4', 'count as a string ("3") is accepted and honoured', ok(p4) && rows(p4).length <= 3 ? 'pass' : 'fail', `HTTP ${p4.status}, rows ${rows(p4).length}`);
  expectInvalid('P5', 'sort outside the enum → 400 INVALID_PARAMS', await post('search_posts', { keywords: kw, sort: 'bogus' }));
  const tricky = '"hiring" AND (designer OR "product manager") NOT intern — café ünïcode 採用';
  const p6 = await post('search_posts', { keywords: tricky, count: 5 });
  const echoed = value(p6)?.query?.keywords;
  // The query echo is this kit's proposal: no echo → inconclusive; an echo that differs → fail.
  const p6status = !ok(p6) ? 'fail' : echoed === undefined ? 'inconclusive' : echoed === tricky ? 'pass' : 'fail';
  add('P6', 'keywords with quotes, Boolean operators and unicode are accepted and passed through unchanged (checked via the proposed query echo)', p6status, ok(p6) ? (echoed === undefined ? 'no value.query echo (proposed field absent)' : `echo ${echoed === tricky ? 'identical' : 'differs'}`) : `HTTP ${p6.status} ${code(p6)}`);
  const p7 = await o.fetch(`${base}/api/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}`, 'Idempotency-Key': `${prefix}-${++keySeq}` }, body: JSON.stringify({ domain: DOMAIN, action: 'search_posts', params: { keywords: { nested: true } } }) });
  const p7b = await p7.json().catch(() => null);
  add('P7', 'non-scalar param → 400', p7.status === 400 ? 'pass' : 'fail', `HTTP ${p7.status}, code ${p7b?.error?.code ?? '-'}`);
  expectInvalid('P8', 'date_posted outside the enum → 400 INVALID_PARAMS', await post('search_posts', { keywords: kw, date_posted: 'last_decade' }));
  expectInvalidProposed('P9', 'search_posts given a pagination_token → 400 INVALID_PARAMS', await post('search_posts', { keywords: kw, pagination_token: 'x' }));
  expectInvalid('P10', 'search_posts_next without pagination_token → 400 INVALID_PARAMS', await post('search_posts_next', { keywords: kw, count: 5 }));
  add('P11', 'page 1 returns at most count rows', rows(first).length <= 5 ? 'pass' : 'fail', `${rows(first).length} rows for count=5`);

  // ---- rows ----
  const spec = MAP_ENTRY.row.fields;
  const shapeProblems = [];
  for (const [i, r] of rows(first).entries()) {
    for (const [f, s] of Object.entries(spec)) {
      const v = r[f];
      if (v === undefined) { if (s.required) shapeProblems.push(`row ${i}: missing ${f}`); continue; }
      const types = s.type.split('|');
      const t = v === null ? 'null' : typeof v;
      if (!types.includes(t)) shapeProblems.push(`row ${i}: ${f} is ${t}, want ${s.type}`);
    }
  }
  add('R1', 'every row has the proposed fields with the proposed types', rows(first).length && !shapeProblems.length ? 'pass' : 'fail', shapeProblems.slice(0, 3).join('; ') || `${rows(first).length} rows`);
  const badLinks = rows(first).filter((r) => {
    try { const u = new URL(r.permalink); return u.protocol !== 'https:' || !/(^|\.)linkedin\.com$/.test(u.hostname) || [...u.searchParams.keys()].some((k) => /^(utm_|trk|trackingid|lipi|rcm)/i.test(k)); } catch { return true; }
  });
  add('R2', 'permalink is an https linkedin.com URL without tracking params', badLinks.length ? 'fail' : 'pass', `${badLinks.length} bad of ${rows(first).length}`);
  const badDates = rows(first).filter((r) => r.posted_at_approx != null && !(typeof r.posted_at_approx === 'string' && ISO_8601.test(r.posted_at_approx) && !Number.isNaN(Date.parse(r.posted_at_approx))));
  add('R3', 'posted_at_approx is null or an ISO-8601 timestamp', badDates.length ? 'fail' : 'pass', `${badDates.length} not ISO-8601`);

  // ---- cursor ----
  const t1 = nextTok(first);
  if (!t1) {
    for (const id of ['C1', 'C2', 'C2s', 'C2d', 'C4', 'D1']) add(id, '(needs ≥2 pages)', 'inconclusive', `first page had no next_token; use keywords with more results than count=5`);
  } else {
    const p2 = await post('search_posts_next', { keywords: kw, pagination_token: t1, count: 5 });
    const urns1 = new Set(rows(first).map((r) => r.activity_urn));
    const overlap = rows(p2).filter((r) => urns1.has(r.activity_urn)).length;
    const identical = rows(p2).length > 0 && overlap === rows(p2).length;
    // A static corpus must not overlap; a live feed can shift between calls, so partial overlap is only inconclusive there.
    const c1 = !ok(p2) || rows(p2).length === 0 || identical ? 'fail' : overlap === 0 ? 'pass' : live ? 'inconclusive' : 'fail';
    add('C1', 'next_token round trip: page 2 succeeds, is not page 1 again, and shares no activity_urn with page 1', c1, `HTTP ${p2.status}, rows ${rows(p2).length}, overlap ${overlap}${identical ? ' (identical page)' : ''}`);
    expectInvalid('C2', 'a cursor reused with different keywords → 400 INVALID_PARAMS (cursor bound to its query)', await post('search_posts_next', { keywords: `${kw} different`, pagination_token: t1, count: 5 }));
    expectInvalid('C2s', 'a cursor reused with a different sort → 400 INVALID_PARAMS', await post('search_posts_next', { keywords: kw, sort: 'latest', pagination_token: t1, count: 5 }));
    expectInvalid('C2d', 'a cursor reused with a different date_posted → 400 INVALID_PARAMS', await post('search_posts_next', { keywords: kw, date_posted: 'past_week', pagination_token: t1, count: 5 }));

    // full walk
    const seenTokens = new Set();
    const allUrns = [];
    let r = first; let pages = 1; let loop = false; let token = t1;
    for (const x of rows(r)) allUrns.push(x.activity_urn);
    while (token && pages < maxPages) {
      if (seenTokens.has(token)) { loop = true; break; }
      seenTokens.add(token);
      r = await post('search_posts_next', { keywords: kw, pagination_token: token, count: 5 });
      if (!ok(r)) break;
      pages += 1;
      for (const x of rows(r)) allUrns.push(x.activity_urn);
      token = nextTok(r);
    }
    // fail only on a repeated token or an error; reaching the page cap with a fresh token is inconclusive (termination not observed).
    const c4 = loop || !ok(r) ? 'fail' : token === null ? 'pass' : 'inconclusive';
    add('C4', `walk never repeats a token and ends with next_token null (observed within ${maxPages} pages)`, c4, loop ? `token repeated at page ${pages}` : !ok(r) ? `HTTP ${r.status} ${code(r)}` : token ? `no loop in ${pages} pages; termination not observed (cap ${maxPages})` : `${pages} pages`);
    const dupes = allUrns.length - new Set(allUrns).size;
    add('D1', 'no activity_urn appears twice across the whole walk', dupes === 0 ? 'pass' : live ? 'inconclusive' : 'fail', `${dupes} duplicate(s) in ${allUrns.length} rows${dupes && live ? ' (a live feed can shift between pages)' : ''}`);
  }
  expectInvalid('C3', 'a malformed pagination_token → 400 INVALID_PARAMS', await post('search_posts_next', { keywords: kw, pagination_token: 'not-a-real-token', count: 5 }));

  // ---- error envelope, receipts, idempotency ----
  const e = p1.body;
  const envOk = p1.status === 400 && e?.ok === false && typeof e?.error?.code === 'string' && typeof e?.error?.message === 'string' && typeof e?.trace_id === 'string';
  add('E1', 'failure envelope: HTTP status from the documented table, ok:false, error.code, error.message, trace_id', envOk ? 'pass' : 'fail', `HTTP ${p1.status}, keys ${Object.keys(e ?? {}).join(',')}`);
  const okCalls = [first, p4, p6].filter(ok);
  // support_id is documented as "Present only on metered calls", so a receipt is required only when a balance is reported.
  const badReceipts = okCalls.filter((r) => (balance(r) !== null && !receipt(r)) || !(credits(r) === null || (Number.isInteger(credits(r)) && credits(r) >= 0)) || !(balance(r) === null || Number.isInteger(balance(r))));
  add('B1', 'every metered success carries a receipt (support_id or billing.receipt_id); credits and balance are integers or null', badReceipts.length ? 'fail' : 'pass', `${badReceipts.length} of ${okCalls.length} non-conforming`);

  const b0 = await post('search_posts', { keywords: kw, count: 1 });
  await post('search_posts', { count: 1 }); // a failure
  const b1 = await post('search_posts', { keywords: kw, count: 1 });
  // Between two successes b0 and b1 there is one rejected call. If the rejected call was free, balance(b0) − balance(b1)
  // equals b1's own charge. Any other spend on the account in between gives a false fail, so run it on a quiet account.
  const B2req = 'a rejected (INVALID_PARAMS) call is not charged (balance delta across it)';
  if (balance(b0) === null || balance(b1) === null) add('B2', B2req, 'inconclusive', 'balance_remaining is null (unmetered account)');
  else if (!Number.isInteger(credits(b1))) add('B2', B2req, 'inconclusive', 'charge of the following call not reported');
  else add('B2', B2req, balance(b0) - balance(b1) === credits(b1) ? 'pass' : 'fail', `balance after success #1 ${balance(b0)} → after success #2 ${balance(b1)}; success #2 charged ${credits(b1)}, so the rejected call in between cost ${balance(b0) - balance(b1) - credits(b1)}`);

  const key = `${prefix}-idem`;
  const i1 = await post('search_posts', { keywords: kw, count: 1 }, { key });
  const i2 = await post('search_posts', { keywords: kw, count: 1 }, { key });
  if (balance(i1) === null) add('I1', 'same Idempotency-Key retried → charged once', 'inconclusive', 'balance_remaining is null');
  else {
    const after = await post('search_posts', { keywords: kw, count: 1 });
    if (!Number.isInteger(credits(after)) || balance(after) === null) add('I1', 'same Idempotency-Key retried → charged once', 'inconclusive', 'charge or balance of the follow-up call not reported');
    else {
      const chargedOnce = balance(after) === balance(i1) - credits(after);
      // Receipt equality is not documented, so it is reported, not required.
      add('I1', 'same Idempotency-Key retried → charged once', chargedOnce ? 'pass' : 'fail', `balance ${balance(i1)} → ${balance(after)} after one further call charged ${credits(after)}; receipts ${receipt(i1)} / ${receipt(i2)} (${receipt(i1) === receipt(i2) ? 'same' : 'different'}; equality not required)`);
    }
  }
  return summarise(results);
}

function summarise(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  return { results, totals: { pass: count('pass'), fail: count('fail'), blocked: count('blocked'), inconclusive: count('inconclusive'), total: results.length } };
}
