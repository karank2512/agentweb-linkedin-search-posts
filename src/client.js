// Execute client for AgentWeb's documented POST /api/execute (REST) and the MCP `execute` tool envelope.
//
// Parses, per the saved public docs (24 Nov 2026):
//   REST success, shape A (OpenAPI ExecuteResponse): {ok:true, result, credits_charged, charged, charge_unit, balance_remaining|null, support_id}
//   REST success, shape B (prose docs):              {ok:true, result, billing:{credits_charged, balance_remaining, receipt_id, policy}}
//   REST failure:                                    {ok:false, error:{code,message,...}, trace_id, support_id} + HTTP status
//   MCP envelope (success/failure):                  {success, domain, action, data:{kind,value}|null, duration_ms, map_version, error?, trace_id?, billing}
//   Plain ErrorResponse (401, 429):                  {error:"string"}; 429 may carry a Retry-After header
// The HTTP implementation is injected. No retries happen here, and no retry delay is ever invented.

import { canonicalJson } from './contract.js';
import {
  AgentWebError, IdempotencyKeyConflictError, RateLimitedError, TransportError, UnauthorizedError, errorFromCode,
} from './errors.js';

/**
 * @typedef {Object} Billing
 * @property {number|null} credits       server-reported charge (charged ?? credits_charged ?? billing.credits_charged)
 * @property {string|null} chargeUnit
 * @property {number|null} balanceRemaining null when absent or reported null
 * @property {boolean} balanceReported   false when the response carried no balance field at all
 * @property {string|null} receiptId
 * @property {string|null} supportId
 * @property {string|null} policy
 * @property {'top-level'|'billing-block'|'both'|'none'} shape
 */

/**
 * @typedef {Object} ExecuteOk
 * @property {true} ok
 * @property {'rest'|'mcp'} lane
 * @property {string} domain
 * @property {string} action
 * @property {string|null} kind
 * @property {any} value
 * @property {string|null} mapVersion
 * @property {number|null} durationMs
 * @property {string[]} notes
 * @property {boolean} cached
 * @property {Billing} billing
 * @property {string|null} traceId
 * @property {number|null} httpStatus
 * @property {string|null} idempotencyKey
 * @property {string[]} warnings
 */

const has = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const firstNum = (...xs) => { for (const x of xs) if (typeof x === 'number') return x; return null; };

/** @returns {Billing} */
export function readBilling(body, result) {
  const block = (has(body, 'billing') && body.billing) || (has(result, 'billing') && result.billing) || null;
  const topLevel = has(body, 'charged') || has(body, 'credits_charged') || has(body, 'charge_unit');
  let balanceRemaining = null;
  let balanceReported = false;
  if (has(body, 'balance_remaining')) { balanceRemaining = body.balance_remaining; balanceReported = true; }
  else if (block && has(block, 'balance_remaining')) { balanceRemaining = block.balance_remaining; balanceReported = true; }
  return {
    credits: firstNum(body?.charged, body?.credits_charged, block?.charged, block?.credits_charged),
    chargeUnit: body?.charge_unit ?? block?.charge_unit ?? null,
    balanceRemaining: typeof balanceRemaining === 'number' ? balanceRemaining : null,
    balanceReported,
    receiptId: block?.receipt_id ?? body?.support_id ?? null,
    supportId: body?.support_id ?? null,
    policy: block?.policy ?? null,
    shape: topLevel && block ? 'both' : topLevel ? 'top-level' : block ? 'billing-block' : 'none',
  };
}

/** Notes may be a string or an array of strings; documented: "cached" marks a saved copy. */
function readNotes(...sources) {
  const out = [];
  for (const s of sources) {
    if (!s || !has(s, 'notes')) continue;
    const n = s.notes;
    if (typeof n === 'string') out.push(n);
    else if (Array.isArray(n)) for (const x of n) if (typeof x === 'string') out.push(x);
  }
  return out;
}

/**
 * Pure parser: turn one HTTP/MCP response into ExecuteOk or a thrown typed error.
 * @param {{status?: number|null, headers?: {get(name:string): string|null}|null, body: any, domain: string, action: string, lane: 'rest'|'mcp', idempotencyKey?: string|null}} r
 * @returns {ExecuteOk}
 */
export function parseExecuteResponse(r) {
  const { body, domain, action, lane } = r;
  const status = r.status ?? null;
  const retryAfter = r.headers?.get?.('retry-after') ?? null; // verbatim; never defaulted
  const base = { domain, action, httpStatus: status, retryAfter, raw: body };

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new TransportError({ ...base, code: 'CLIENT_UNREADABLE_RESPONSE', message: `Response body is not a JSON object (HTTP ${status})` });
  }

  // Plain ErrorResponse: {error: "string"} (OpenAPI documents it for 401, 403 and 429).
  if (typeof body.error === 'string' && !has(body, 'ok') && !has(body, 'success')) {
    if (status === 429) return throwErr(new RateLimitedError({ ...base, code: 'RATE_LIMITED', message: body.error, codeInferredFromStatus: true }));
    if (status === 401) return throwErr(new UnauthorizedError({ ...base, code: 'UNAUTHORIZED', message: body.error, codeInferredFromStatus: true }));
    if (status === 403) return throwErr(new AgentWebError({ ...base, code: 'FORBIDDEN', message: body.error, codeInferredFromStatus: true }));
    return throwErr(new AgentWebError({ ...base, code: 'UNKNOWN', message: body.error }));
  }

  let envelope; // the ExecuteResult-like object: {success, data, duration_ms, map_version, notes, error, trace_id}
  let ok;
  if (has(body, 'ok')) {
    ok = body.ok === true;
    envelope = ok ? (body.result ?? {}) : body;
    if (ok && envelope && envelope.success === false) ok = false; // payload reports failure despite ok:true
  } else if (has(body, 'success')) {
    ok = body.success === true;
    envelope = body;
  } else {
    throw new TransportError({ ...base, code: 'CLIENT_UNREADABLE_RESPONSE', message: 'Response is not a documented execute envelope' });
  }

  const billing = readBilling(body, has(body, 'result') ? body.result : null);
  const traceId = body.trace_id ?? envelope?.trace_id ?? body.error?.trace_id ?? null;
  const mapVersion = envelope?.map_version ?? body.map_version ?? null;

  if (!ok) {
    const errObj = (typeof body.error === 'object' && body.error) || (typeof envelope?.error === 'object' && envelope.error) || {};
    throw errorFromCode(errObj, {
      ...base,
      traceId,
      supportId: body.support_id ?? null,
      receiptId: billing.receiptId,
      billing,
    });
  }

  const notes = readNotes(envelope, body);
  const data = envelope?.data ?? null;
  return {
    ok: true,
    lane,
    domain: envelope?.domain ?? domain,
    action: envelope?.action ?? action,
    kind: data?.kind ?? null,
    value: data && has(data, 'value') ? data.value : data,
    mapVersion,
    durationMs: firstNum(envelope?.duration_ms, body.duration_ms),
    notes,
    cached: notes.some((n) => /\bcached\b/i.test(n) && !/\b(not|un|non)[\s-]*cached\b/i.test(n)),
    billing,
    traceId,
    httpStatus: status,
    idempotencyKey: r.idempotencyKey ?? null,
    warnings: [],
  };
}

function throwErr(e) { throw e; }

/** Unwrap an MCP CallToolResult into the envelope object, if it is wrapped. */
export function unwrapMcpResult(res) {
  if (res && typeof res === 'object') {
    if (res.structuredContent && typeof res.structuredContent === 'object') return res.structuredContent;
    if (Array.isArray(res.content)) {
      const t = res.content.find((c) => c?.type === 'text' && typeof c.text === 'string');
      if (t) { try { return JSON.parse(t.text); } catch { return null; } }
    }
  }
  return res;
}

/**
 * @param {Object} opts
 * @param {string} [opts.baseUrl]  default http://localhost (inert; tests inject fetch). A non-loopback host
 *   such as the documented https://mcp.agentweb.us is refused unless opts.allowLive === true.
 * @param {boolean} [opts.allowLive] explicit opt-in for any non-loopback baseUrl (real, billed calls)
 * @param {string} [opts.apiKey]   aw_ key (REST lane)
 * @param {typeof fetch} [opts.fetch] injected fetch (REST lane)
 * @param {(tool: string, args: object) => Promise<any>} [opts.mcpCall] injected MCP tool caller (MCP lane)
 * @param {import('./ledger.js').TraceLedger} [opts.ledger]
 */
export function createClient(opts = {}) {
  const baseUrl = (opts.baseUrl ?? 'http://localhost').replace(/\/+$/, '');
  let host;
  try { host = new URL(baseUrl).hostname; } catch { throw new TypeError(`createClient: invalid baseUrl ${JSON.stringify(baseUrl)}`); }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
  if (!opts.mcpCall && !loopback && opts.allowLive !== true) {
    throw new Error(`createClient: refusing non-loopback baseUrl ${new URL(baseUrl).origin} without allowLive: true (that would make real, billed calls)`);
  }
  const lane = opts.mcpCall ? 'mcp' : 'rest';
  if (lane === 'rest' && typeof opts.fetch !== 'function') throw new TypeError('createClient: inject a fetch implementation (opts.fetch) or an mcpCall');
  /** key -> canonical request body */
  const usedKeys = new Map();

  /**
   * @param {{domain: string, action: string, params?: Record<string, string|number|boolean>}} req
   * @param {{idempotencyKey?: string, fresh?: boolean, meta?: Record<string, unknown>}} [o]
   * @returns {Promise<ExecuteOk>}
   */
  async function execute(req, o = {}) {
    const params = req.params ?? {};
    for (const [k, v] of Object.entries(params)) {
      if (!['string', 'number', 'boolean'].includes(typeof v)) {
        throw errorFromCode({ code: 'INVALID_PARAMS', message: `param "${k}" must be a flat scalar (client-side check)` }, { domain: req.domain, action: req.action });
      }
    }
    const reqBody = { domain: req.domain, action: req.action, params };
    if (o.fresh !== undefined) reqBody.fresh = Boolean(o.fresh);
    const key = o.idempotencyKey ?? null;
    if (key) {
      const canon = canonicalJson(reqBody);
      const prev = usedKeys.get(key);
      if (prev !== undefined && prev !== canon) throw new IdempotencyKeyConflictError(key);
      usedKeys.set(key, canon);
    }

    let result;
    let error;
    const warnings = [];
    try {
      if (lane === 'rest') {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
        if (key) headers['Idempotency-Key'] = key;
        let res;
        try {
          res = await opts.fetch(`${baseUrl}/api/execute`, { method: 'POST', headers, body: JSON.stringify(reqBody) });
        } catch (e) {
          throw new TransportError({ code: 'CLIENT_NETWORK', message: `fetch failed: ${e?.message ?? e}`, domain: req.domain, action: req.action });
        }
        let body = null;
        const text = await res.text();
        try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        result = parseExecuteResponse({ status: res.status, headers: res.headers, body, domain: req.domain, action: req.action, lane, idempotencyKey: key });
      } else {
        // The MCP execute input schema documents domain, action, params, on_behalf_of only.
        if (key) warnings.push('Idempotency-Key not sent: the MCP execute tool schema has no idempotency field');
        if (o.fresh !== undefined) warnings.push('fresh not sent: the MCP execute tool schema has no fresh field');
        const raw = await opts.mcpCall('execute', { domain: req.domain, action: req.action, params });
        result = parseExecuteResponse({ status: null, headers: null, body: unwrapMcpResult(raw), domain: req.domain, action: req.action, lane, idempotencyKey: null });
      }
      result.warnings.push(...warnings);
      return result;
    } catch (e) {
      error = e;
      throw e;
    } finally {
      if (opts.ledger && !(error instanceof IdempotencyKeyConflictError)) {
        const b = result?.billing ?? error?.billing ?? null;
        opts.ledger.record({
          lane,
          domain: req.domain,
          action: req.action,
          ok: Boolean(result),
          code: error?.code ?? null,
          http_status: result?.httpStatus ?? error?.httpStatus ?? null,
          receipt_id: b?.receiptId ?? error?.receiptId ?? null,
          support_id: b?.supportId ?? error?.supportId ?? null,
          trace_id: result?.traceId ?? error?.traceId ?? null,
          map_version: result?.mapVersion ?? (error?.raw && typeof error.raw === 'object' ? (error.raw.map_version ?? error.raw.result?.map_version ?? null) : null),
          duration_ms: result?.durationMs ?? (error?.raw && typeof error.raw === 'object' ? (error.raw.duration_ms ?? null) : null),
          credits: b?.credits ?? null,
          charge_unit: b?.chargeUnit ?? null,
          balance_remaining: b?.balanceRemaining ?? null,
          cached: Boolean(result?.cached),
          idempotency_key: lane === 'rest' ? key : null,
          meta: o.meta ?? {},
        });
      }
    }
  }

  return { execute, lane, baseUrl };
}
