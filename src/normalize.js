// Normalise list_profile_posts-shaped rows (and proposed search_posts rows) into a typed Post, and dedupe.

/**
 * @typedef {Object} Post
 * @property {string|null} urn                 activity_urn as given (trimmed)
 * @property {'activity'|'share'|'ugcPost'|'other'|null} urn_type
 * @property {string|null} permalink
 * @property {'share_url'|'constructed_from_urn'|null} permalink_source
 * @property {boolean} permalink_constructed   true when built from the URN (format to confirm with AgentWeb)
 * @property {string} text
 * @property {{name: string|null, headline: string|null, url: string|null}} author
 * @property {string|null} header
 * @property {string|null} age_text
 * @property {{iso: string, approximate: true, basis: string, granularity: string}|null} posted_at
 * @property {{reactions: number|null, comments: number|null, reposts: number|null}} engagement
 * @property {string|null} thread_urn
 * @property {string|null} thread_id
 * @property {null|{reposter: string|null, commentary: string, original: {author: string|null, text: string|null, urn: string|null, missing: boolean}}} repost
 * @property {string[]} flags
 * @property {boolean} synthetic
 */

const TRACKING_PARAMS = new Set([
  'trk', 'trkinfo', 'trackingid', 'lipi', 'licu', 'midtoken', 'midsig', 'trkemail', 'eid', 'otptoken',
  'refid', 'original_referer', 'rcm', 'li_fat_id', 'fbclid', 'gclid', 'mc_cid', 'mc_eid',
]);

/**
 * Remove tracking query params (utm_* and a fixed list) and the fragment. Other params are kept.
 * @param {string} url
 * @returns {string|null} null when not a parseable http(s) URL
 */
export function stripTracking(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  for (const k of [...u.searchParams.keys()]) {
    const lk = k.toLowerCase();
    if (lk.startsWith('utm_') || TRACKING_PARAMS.has(lk)) u.searchParams.delete(k);
  }
  u.hash = '';
  if (u.protocol === 'http:') u.protocol = 'https:';
  return u.toString();
}

/** @param {string|null|undefined} urn */
export function parseUrn(urn) {
  if (typeof urn !== 'string') return null;
  const s = urn.trim();
  const m = /^urn:li:(activity|share|ugcPost):(\d+)$/i.exec(s);
  if (!m) return s ? { urn: s, type: 'other', id: null } : null;
  const type = m[1].toLowerCase() === 'ugcpost' ? 'ugcPost' : m[1].toLowerCase();
  return { urn: `urn:li:${type}:${m[2]}`, type, id: m[2] };
}

/**
 * Build a permalink from a URN. The /feed/update/<urn>/ form is commonly seen but NOT confirmed by AgentWeb,
 * so callers get permalink_constructed=true.
 */
export function permalinkFromUrn(urn) {
  const p = parseUrn(urn);
  if (!p || p.type === 'other') return null;
  return `https://www.linkedin.com/feed/update/${p.urn}/`;
}

const AGE_UNITS = [
  // [regex, ms, granularity]
  [/^(\d+)\s*(s|sec|secs|second|seconds)$/, 1000, 'second'],
  [/^(\d+)\s*(m|min|mins|minute|minutes)$/, 60_000, 'minute'],
  [/^(\d+)\s*(h|hr|hrs|hour|hours)$/, 3_600_000, 'hour'],
  [/^(\d+)\s*(d|day|days)$/, 86_400_000, 'day'],
  [/^(\d+)\s*(w|wk|wks|week|weeks)$/, 7 * 86_400_000, 'week'],
  [/^(\d+)\s*(mo|mos|month|months)$/, 30 * 86_400_000, 'month'],
  [/^(\d+)\s*(y|yr|yrs|year|years)$/, 365 * 86_400_000, 'year'],
];

/**
 * Turn a relative age ("3h", "2d", "1 week ago", "Edited • 5d") into an approximate timestamp.
 * @param {string|null|undefined} age
 * @param {Date} now
 */
export function approxPostedAt(age, now) {
  if (typeof age !== 'string') return null;
  let s = age.toLowerCase().replace(/edited/g, '').replace(/[•·]/g, ' ').replace(/\bago\b/g, '').replace(/\s+/g, ' ').trim();
  if (s === 'now' || s === 'just now') return { iso: now.toISOString(), approximate: true, basis: 'relative_age', granularity: 'minute' };
  for (const [re, ms, gran] of AGE_UNITS) {
    const m = re.exec(s);
    if (m) return { iso: new Date(now.getTime() - Number(m[1]) * ms).toISOString(), approximate: true, basis: 'relative_age', granularity: gran };
  }
  return null;
}

const num = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\s*[\d,]+\s*$/.test(v)) return Number(v.replace(/[,\s]/g, ''));
  return null;
};
const str = (v) => (typeof v === 'string' && v.length ? v : null);

/**
 * @param {Record<string, any>} row
 * @param {{now?: Date}} [opts]
 * @returns {Post}
 */
export function normalizeRow(row, opts = {}) {
  const now = opts.now ?? new Date();
  const flags = [];
  const parsed = parseUrn(row.activity_urn);
  if (!parsed) flags.push('no_urn');
  else if (parsed.type === 'other') flags.push('unrecognised_urn_format');

  let permalink = null;
  let permalinkSource = null;
  const shareUrl = str(row.permalink) ?? str(row.share_url) ?? str(row.url);
  if (shareUrl) {
    const stripped = stripTracking(shareUrl);
    if (stripped && /(^|\.)linkedin\.com$/i.test(new URL(stripped).hostname)) {
      permalink = stripped;
      // An upstream row may declare that its permalink was itself built from the URN; keep that flag.
      const declaredConstructed = row.permalink_source === 'constructed_from_urn' && str(row.permalink);
      // Without a declared source, a /feed/update/urn:li:… link is the URN-built form, not a share URL.
      const looksConstructed = row.permalink_source == null && /\/feed\/update\/urn:li:/i.test(stripped);
      if (declaredConstructed || looksConstructed) { permalinkSource = 'constructed_from_urn'; flags.push('permalink_constructed'); }
      else permalinkSource = 'share_url';
    }
    else flags.push('share_url_rejected');
  }
  if (!permalink && parsed) {
    const built = permalinkFromUrn(parsed.urn);
    if (built) { permalink = built; permalinkSource = 'constructed_from_urn'; flags.push('permalink_constructed'); }
  }
  if (!permalink) flags.push('no_permalink');

  const postedAt = approxPostedAt(row.age, now);
  if (row.age && !postedAt) flags.push('age_unparsed');

  const resharedAuthor = str(row.reshared_author);
  const resharedText = str(row.reshared_text);
  const header = str(row.header);
  const headerSaysRepost = header ? /\brepost(ed)?\b/i.test(header) : false;
  let repost = null;
  if (resharedAuthor || resharedText || headerSaysRepost || str(row.reshared_activity_urn)) {
    const origUrn = parseUrn(row.reshared_activity_urn)?.urn ?? null;
    const missing = !resharedAuthor && !resharedText;
    if (missing) flags.push('repost_original_missing');
    if (!origUrn) flags.push('repost_original_urn_unknown');
    repost = {
      reposter: str(row.author),
      commentary: typeof row.text === 'string' ? row.text : '',
      original: { author: resharedAuthor, text: resharedText, urn: origUrn, missing },
    };
  }

  return {
    urn: parsed?.urn ?? null,
    urn_type: parsed?.type ?? null,
    permalink,
    permalink_source: permalinkSource,
    permalink_constructed: permalinkSource === 'constructed_from_urn',
    text: typeof row.text === 'string' ? row.text : '',
    author: { name: str(row.author), headline: str(row.author_headline), url: str(row.author_url) ? stripTracking(row.author_url) : null },
    header,
    age_text: str(row.age),
    posted_at: postedAt,
    engagement: { reactions: num(row.reactions), comments: num(row.comments), reposts: num(row.reposts) },
    thread_urn: str(row.thread_urn),
    thread_id: row.thread_id != null ? String(row.thread_id) : null,
    repost,
    flags,
    synthetic: row.synthetic === true,
  };
}

/**
 * Dedupe posts.
 * - identical URN → kept once (first occurrence wins; later occurrences counted in `duplicates_removed`).
 * - identical share-URL permalink (not constructed) → same post, kept once.
 * - different URN types sharing a thread_urn → NOT merged (the mapping between URN types is not public); both flagged.
 * - no URN → kept, flagged; same author+text → flagged possible_duplicate, not removed.
 * - a repost and its original are distinct posts; both kept and linked via repost.original.urn when known.
 * @param {Post[]} posts
 */
export function dedupePosts(posts) {
  const byUrn = new Map();
  const byPermalink = new Map();
  const byThread = new Map();
  const byContent = new Map();
  const out = [];
  let removed = 0;
  for (const p of posts) {
    if (p.urn && byUrn.has(p.urn)) { removed++; continue; }
    if (p.permalink && !p.permalink_constructed && byPermalink.has(p.permalink)) { removed++; continue; }
    const q = { ...p, flags: [...p.flags] };
    if (q.urn) byUrn.set(q.urn, q);
    if (q.permalink && !q.permalink_constructed) byPermalink.set(q.permalink, q);
    if (q.thread_urn && q.urn && !q.repost) {
      const group = byThread.get(q.thread_urn) ?? [];
      for (const other of group) {
        if (other.urn_type === q.urn_type) continue;
        q.flags.push(`possible_same_post_as:${other.urn}`);
        other.flags.push(`possible_same_post_as:${q.urn}`);
      }
      group.push(q);
      byThread.set(q.thread_urn, group);
    }
    if (!q.urn) {
      const ck = `${q.author.url ?? q.author.name ?? ''}\u0000${q.text}`;
      const other = byContent.get(ck);
      if (other) q.flags.push('possible_duplicate_no_urn');
      else byContent.set(ck, q);
    }
    out.push(q);
  }
  // Link reposts to originals present in the result set.
  for (const q of out) {
    if (q.repost?.original.urn && byUrn.has(q.repost.original.urn)) q.flags.push('original_in_results');
  }
  return { posts: out, duplicates_removed: removed };
}
