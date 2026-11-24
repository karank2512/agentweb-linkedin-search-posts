// Trace ledger: one entry per execute call, success or failure.
// Every number is as reported by the server; nothing is invented. Unreported credits stay null.

/**
 * @typedef {Object} LedgerEntry
 * @property {number} seq
 * @property {string} lane            'rest' | 'mcp'
 * @property {string} domain
 * @property {string} action
 * @property {boolean} ok
 * @property {string|null} code       error code on failure
 * @property {number|null} http_status
 * @property {string|null} receipt_id billing.receipt_id (or support_id when only that is present)
 * @property {string|null} support_id
 * @property {string|null} trace_id
 * @property {string|null} map_version
 * @property {number|null} duration_ms server-reported
 * @property {number|null} credits     server-reported charge; null if not reported
 * @property {string|null} charge_unit
 * @property {number|null} balance_remaining
 * @property {boolean} cached          notes contained "cached"
 * @property {string|null} idempotency_key
 * @property {Record<string, unknown>} [meta] caller labels (page, profile_id, ...)
 */

export class TraceLedger {
  constructor() {
    /** @type {LedgerEntry[]} */
    this.entries = [];
  }

  /** @param {Omit<LedgerEntry, 'seq'>} entry */
  record(entry) {
    const e = { seq: this.entries.length + 1, ...entry };
    this.entries.push(e);
    return e;
  }

  /** Totals as reported. `credits_reported` sums only calls that reported a charge. */
  totals() {
    let credits = 0;
    let unreported = 0;
    for (const e of this.entries) {
      if (typeof e.credits === 'number') credits += e.credits;
      else unreported += 1;
    }
    const units = [...new Set(this.entries.map((e) => e.charge_unit).filter(Boolean))];
    return {
      calls: this.entries.length,
      ok: this.entries.filter((e) => e.ok).length,
      failed: this.entries.filter((e) => !e.ok).length,
      credits_reported: credits,
      calls_without_reported_charge: unreported,
      charge_units: units,
      receipt_ids: this.entries.map((e) => e.receipt_id).filter(Boolean),
      trace_ids: this.entries.map((e) => e.trace_id).filter(Boolean),
      cached_calls: this.entries.filter((e) => e.cached).length,
      map_versions: [...new Set(this.entries.map((e) => e.map_version).filter(Boolean))],
    };
  }

  /** Fixed-width text lines for terminal output. */
  toLines(prefix = '') {
    const head = `${prefix}seq lane action                    ok  code                  receipt/support            trace             map        ms    credits cached`;
    const rows = this.entries.map((e) => [
      prefix + String(e.seq).padEnd(3),
      e.lane.padEnd(4),
      e.action.padEnd(25),
      (e.ok ? 'yes' : 'no').padEnd(3),
      String(e.code ?? '-').padEnd(21),
      String(e.receipt_id ?? e.support_id ?? '-').padEnd(26),
      String(e.trace_id ?? '-').padEnd(17),
      String(e.map_version ?? '-').padEnd(10),
      String(e.duration_ms ?? '-').padEnd(5),
      String(e.credits ?? 'n/r').padEnd(7),
      e.cached ? 'yes' : 'no',
    ].join(' '));
    return [head, ...rows];
  }
}
