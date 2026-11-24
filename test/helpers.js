// Test helpers: a scripted fetch that records every request. No network.

/**
 * @param {Array<(req: {url: string, headers: Record<string,string>, body: any, n: number}) => {status?: number, body?: any, headers?: Record<string,string>, raw?: string}>|Function} script
 *   an array (one handler per call, in order) or a single function used for every call
 */
export function scriptedFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    const body = init?.body ? JSON.parse(init.body) : null;
    const n = calls.length;
    calls.push({ url, headers, body });
    const h = typeof script === 'function' ? script : script[n];
    if (!h) throw new Error(`scriptedFetch: no response scripted for call ${n + 1}`);
    const r = h({ url, headers, body, n });
    const text = r.raw !== undefined ? r.raw : JSON.stringify(r.body ?? null);
    return new Response(text, { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...(r.headers ?? {}) } });
  };
  fn.calls = calls;
  return fn;
}

let receiptSeq = 0;
/** REST success, OpenAPI shape A (top-level billing). */
export function restOk(value, o = {}) {
  receiptSeq += 1;
  return {
    status: 200,
    body: {
      ok: true,
      result: { success: true, domain: 'linkedin.com', action: o.action ?? 'search_posts', data: { kind: 'json', value }, duration_ms: o.duration_ms ?? 100, map_version: o.map_version ?? '0.7.2', ...(o.notes ? { notes: o.notes } : {}) },
      credits_charged: o.credits ?? 1,
      charged: o.credits ?? 1,
      charge_unit: 'credit',
      balance_remaining: o.balance === undefined ? 100 : o.balance,
      support_id: o.receipt ?? `awr_test_${receiptSeq}`,
    },
  };
}

/** REST failure. */
export function restErr(code, status, o = {}) {
  return { status, headers: o.headers, body: { ok: false, error: { code, message: o.message ?? `${code} (test)`, ...(o.extra ?? {}) }, trace_id: o.trace ?? 'tr_test', support_id: o.support ?? 'awr_test_fail' } };
}

/** Rows in the list_profile_posts shape. */
export function row(id, o = {}) {
  return {
    synthetic: true,
    activity_urn: o.urn === undefined ? `urn:li:activity:${id}` : o.urn,
    text: o.text ?? `post ${id}`,
    age: o.age ?? '1d',
    reactions: 1, comments: 0, reposts: 0,
    author: o.author ?? `Author ${id}`,
    author_headline: null, author_url: null, header: o.header ?? null,
    thread_urn: o.thread_urn ?? null, thread_id: null,
    reshared_author: o.reshared_author ?? null, reshared_text: o.reshared_text ?? null,
    ...(o.extra ?? {}),
  };
}

export const FIXED_NOW = new Date('2026-11-24T00:00:00.000Z');
