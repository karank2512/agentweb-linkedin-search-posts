// Validator and normaliser for the PROPOSED search_posts / search_posts_next params.
// The contract lives in contract/search_posts.map-entry.json; this file only reads it.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { InvalidParamsError } from './errors.js';

export const DOMAIN = 'linkedin.com';
export const SEARCH_ACTION = 'search_posts';
export const SEARCH_NEXT_ACTION = 'search_posts_next';

/** @type {any} */
export const MAP_ENTRY = JSON.parse(
  readFileSync(new URL('../contract/search_posts.map-entry.json', import.meta.url), 'utf8'),
);

/** @param {string} action */
export function paramSpec(action) {
  const a = MAP_ENTRY.actions.find((x) => x.name === action);
  if (!a) throw new Error(`No proposed spec for action ${action}`);
  return a.params;
}

/**
 * @typedef {Object} SearchParams
 * @property {string} keywords
 * @property {'relevance'|'latest'} sort
 * @property {'any'|'past_24h'|'past_week'|'past_month'} date_posted
 * @property {number} count
 * @property {string} [pagination_token]
 */

const isScalar = (v) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

function fail(action, message) {
  return new InvalidParamsError({ code: 'INVALID_PARAMS', message, domain: DOMAIN, action, httpStatus: 400 });
}

/**
 * Validate and normalise params for search_posts or search_posts_next.
 * Keywords are never altered. Defaults are filled in. Throws InvalidParamsError.
 * @param {string} action
 * @param {Record<string, unknown>} params
 * @returns {SearchParams}
 */
export function validateSearchParams(action, params) {
  const spec = paramSpec(action);
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw fail(action, 'params must be a flat object');
  }
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    if (!(k in spec)) throw fail(action, `unknown param "${k}"; allowed: ${Object.keys(spec).join(', ')}`);
    if (v === undefined) continue;
    if (!isScalar(v)) throw fail(action, `param "${k}" must be a string, number or boolean (flat params only)`);
  }
  for (const [name, s] of Object.entries(spec)) {
    let v = params[name];
    if (v === undefined || v === null) {
      if (s.required) throw fail(action, `missing required param "${name}"`);
      if (s.default !== undefined) out[name] = s.default;
      continue;
    }
    if (s.type === 'string') {
      if (typeof v !== 'string') throw fail(action, `param "${name}" must be a string`);
      if (s.minLength && v.trim().length < s.minLength) throw fail(action, `param "${name}" must not be empty`);
      if (s.maxLength && v.length > s.maxLength) throw fail(action, `param "${name}" exceeds ${s.maxLength} characters`);
      if (s.enum && !s.enum.includes(v)) throw fail(action, `param "${name}" must be one of ${s.enum.join(', ')}`);
      out[name] = v; // unchanged: no trim, no case folding, no escaping
    } else if (s.type === 'number') {
      let n = v;
      if (typeof v === 'string') {
        if (!/^\s*-?\d+(\.\d+)?\s*$/.test(v)) throw fail(action, `param "${name}" must be numeric`);
        n = Number(v);
      }
      if (typeof n !== 'number' || !Number.isFinite(n)) throw fail(action, `param "${name}" must be a number`);
      if (s.integer && !Number.isInteger(n)) throw fail(action, `param "${name}" must be an integer`);
      if (s.minimum !== undefined && n < s.minimum) throw fail(action, `param "${name}" must be >= ${s.minimum}`);
      if (s.maximum !== undefined && n > s.maximum) throw fail(action, `param "${name}" must be <= ${s.maximum}`);
      out[name] = n;
    }
  }
  return /** @type {SearchParams} */ (out);
}

/**
 * Stable fingerprint of the query part of a request (keywords, sort, date_posted).
 * A cursor is bound to this; count is deliberately excluded so page size may vary.
 * @param {Partial<SearchParams>} p normalised params
 */
export function queryFingerprint(p) {
  const canon = JSON.stringify([p.keywords, p.sort ?? 'relevance', p.date_posted ?? 'any']);
  return createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

/** Canonical JSON (sorted keys) for comparing request bodies. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
