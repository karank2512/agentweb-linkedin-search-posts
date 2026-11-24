// Typed errors for AgentWeb's documented execute error codes.
//
// Sources (AgentWeb's public docs, read 24 Nov 2026):
//   - REST API docs (docs.agentweb.us/rest-api), "Execute" section: the error.code table and the delegation codes
//   - OpenAPI (www.agentweb.us/openapi.json), POST /api/execute responses: USAGE_CAP_EXCEEDED (403),
//     PARAM_UNRESOLVED (422), PAGE_CHANGED (502)
// The enum is treated as open: any code not listed here becomes a generic AgentWebError.

/**
 * @typedef {Object} ErrorContext
 * @property {string} [code]
 * @property {string} [message]
 * @property {number|null} [httpStatus]
 * @property {string|null} [traceId]
 * @property {string|null} [supportId]
 * @property {string|null} [receiptId]
 * @property {Object|null} [billing]       Normalised billing block, if the failure carried one.
 * @property {Object|null} [details]       Code-specific documented sub-objects (auth, credits, delegation, resolve, usage_cap).
 * @property {string|null} [retryAfter]    Verbatim Retry-After header value, only when the server sent one. Never defaulted.
 * @property {string|null} [domain]
 * @property {string|null} [action]
 * @property {boolean} [codeInferredFromStatus] True when the body had no code and it was derived from the HTTP status.
 * @property {unknown} [raw]
 */

export class AgentWebError extends Error {
  /** @param {ErrorContext} ctx */
  constructor(ctx = {}) {
    super(ctx.message || ctx.code || 'AgentWeb error');
    this.name = this.constructor.name;
    this.code = ctx.code ?? 'UNKNOWN';
    this.httpStatus = ctx.httpStatus ?? null;
    this.traceId = ctx.traceId ?? null;
    this.supportId = ctx.supportId ?? null;
    this.receiptId = ctx.receiptId ?? null;
    this.billing = ctx.billing ?? null;
    this.details = ctx.details ?? null;
    this.retryAfter = ctx.retryAfter ?? null;
    this.domain = ctx.domain ?? null;
    this.action = ctx.action ?? null;
    this.codeInferredFromStatus = Boolean(ctx.codeInferredFromStatus);
    this.raw = ctx.raw;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      traceId: this.traceId,
      supportId: this.supportId,
      receiptId: this.receiptId,
      retryAfter: this.retryAfter,
      details: this.details,
      domain: this.domain,
      action: this.action,
    };
  }
}

export class InvalidParamsError extends AgentWebError {}
export class InsufficientCreditsError extends AgentWebError {
  /** Documented: error.credits carries the top-up link. */
  get credits() { return this.details?.credits ?? null; }
}
export class PaymentDeclinedError extends AgentWebError {}
export class BillingAccountRestrictedError extends AgentWebError {}
export class AuthRequiredError extends AgentWebError {
  /** Documented: error.auth describes which connection is needed. */
  get auth() { return this.details?.auth ?? null; }
}
export class AuthMisconfiguredError extends AgentWebError {}
export class MapNotFoundError extends AgentWebError {}
/** ACTION_NOT_FOUND: the action is not in the domain's map. */
export class UnsupportedActionError extends AgentWebError {
  constructor(ctx = {}) {
    const target = `${ctx.domain ?? '?'}/${ctx.action ?? '?'}`;
    super({ ...ctx, message: `${target} is not available in AgentWeb's map (ACTION_NOT_FOUND). ${ctx.message ?? ''}`.trim() });
    this.target = target;
  }
}
export class RateLimitedError extends AgentWebError {}
export class PaymentNotSupportedError extends AgentWebError {}
export class UpstreamError extends AgentWebError {}
export class UpstreamAppError extends AgentWebError {}
export class ParseError extends AgentWebError {}
export class CuratedMapStaleError extends AgentWebError {}
export class PageChangedError extends AgentWebError {}
export class BillingUnavailableError extends AgentWebError {}
export class TimeoutError extends AgentWebError {}
export class UsageCapExceededError extends AgentWebError {}
export class ParamUnresolvedError extends AgentWebError {}
export class DelegationError extends AgentWebError {
  get delegation() { return this.details?.delegation ?? null; }
}
/** HTTP 401 from the documented Unauthorized response (ErrorResponse shape, no code). */
export class UnauthorizedError extends AgentWebError {}

// ---- client-side errors (never sent by the server) ----

/** The same Idempotency-Key was reused with a different request body. Thrown before any network call. */
export class IdempotencyKeyConflictError extends AgentWebError {
  constructor(key, msg) { super({ code: 'CLIENT_IDEMPOTENCY_CONFLICT', message: msg ?? `Idempotency-Key "${key}" was already used with different params` }); this.key = key; }
}
/** The response could not be read as any documented envelope. */
export class TransportError extends AgentWebError {}
/** A client-side credit budget would be exceeded by the next call. */
export class BudgetExceededError extends AgentWebError {}

/** Documented code → class, with the HTTP status the REST lane documents. */
export const ERROR_CODES = Object.freeze({
  INVALID_PARAMS: { cls: InvalidParamsError, http: 400 },
  INSUFFICIENT_CREDITS: { cls: InsufficientCreditsError, http: 402 },
  PAYMENT_DECLINED: { cls: PaymentDeclinedError, http: 402 },
  BILLING_ACCOUNT_RESTRICTED: { cls: BillingAccountRestrictedError, http: 403 },
  AUTH_REQUIRED: { cls: AuthRequiredError, http: 403 },
  AUTH_MISCONFIGURED: { cls: AuthMisconfiguredError, http: 403 },
  USAGE_CAP_EXCEEDED: { cls: UsageCapExceededError, http: 403 },
  MAP_NOT_FOUND: { cls: MapNotFoundError, http: 404 },
  ACTION_NOT_FOUND: { cls: UnsupportedActionError, http: 404 },
  PARAM_UNRESOLVED: { cls: ParamUnresolvedError, http: 422 },
  RATE_LIMITED: { cls: RateLimitedError, http: 429 },
  PAYMENT_NOT_SUPPORTED: { cls: PaymentNotSupportedError, http: 501 },
  UPSTREAM_ERROR: { cls: UpstreamError, http: 502 },
  UPSTREAM_APP_ERROR: { cls: UpstreamAppError, http: 502 },
  PARSE_ERROR: { cls: ParseError, http: 502 },
  CURATED_MAP_STALE: { cls: CuratedMapStaleError, http: 502 },
  PAGE_CHANGED: { cls: PageChangedError, http: 502 },
  BILLING_UNAVAILABLE: { cls: BillingUnavailableError, http: 503 },
  TIMEOUT: { cls: TimeoutError, http: 504 },
  MEMBER_NOT_LINKED: { cls: DelegationError, http: null },
  APPROVAL_PENDING: { cls: DelegationError, http: null },
  DELEGATION_DENIED: { cls: DelegationError, http: null },
});

/** Sub-objects the docs name on specific codes; copied verbatim when present. */
const DETAIL_KEYS = ['auth', 'credits', 'delegation', 'resolve', 'usage_cap'];

/**
 * Build the typed error for a server error object.
 * @param {Record<string, any>} errorObj  The `error` object from an envelope.
 * @param {ErrorContext} ctx
 */
export function errorFromCode(errorObj, ctx = {}) {
  const code = errorObj?.code ?? ctx.code ?? 'UNKNOWN';
  const details = {};
  for (const k of DETAIL_KEYS) if (errorObj && errorObj[k] !== undefined) details[k] = errorObj[k];
  const entry = ERROR_CODES[code];
  const Cls = entry ? entry.cls : AgentWebError;
  return new Cls({
    ...ctx,
    code,
    message: errorObj?.message ?? ctx.message,
    details: Object.keys(details).length ? details : null,
  });
}

/** Codes after which a retry of the same page (same Idempotency-Key) can make sense. Caller opts in. */
export const TRANSIENT_CODES = Object.freeze(['RATE_LIMITED', 'TIMEOUT', 'UPSTREAM_ERROR', 'BILLING_UNAVAILABLE']);
