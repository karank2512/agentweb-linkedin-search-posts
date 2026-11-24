// Deterministic, explainable hiring-intent scorer: fixed patterns and weights. No learned component, no network, no randomness.
// Signals describe the *act of hiring* only. There are deliberately no industry, location, role or seniority terms:
// those belong in the user's keywords, not in the scorer.

/**
 * @typedef {Object} Signal
 * @property {string} id
 * @property {number} weight
 * @property {RegExp} re
 * @property {boolean} [hard]    hard negative: forces the "unlikely" label
 * @property {RegExp} [unless]   if this matches the ~40 chars before the match, the signal does not fire
 */

/** @type {Signal[]} */
export const SIGNALS = [
  // ---- positive: someone is hiring ----
  { id: 'we_are_hiring', weight: 3, re: /\b(we'?re|we are|i'?m|i am|is|are|now)\s+(now\s+|actively\s+|also\s+|currently\s+)?hiring\b/, unless: /(\b(who|who's|anyone|is anyone|which|companies|are you)\b[^.!?,]{0,25}|\b(if|when) (you|your)\b[^.!?,]{0,14})$/ },
  { id: 'we_are_recruiting', weight: 3, re: /\b(we'?re|we are|i'?m|i am|is|are)\s+(now\s+|currently\s+)?recruiting\b/ },
  { id: 'vacancy', weight: 2, re: /\b(vacancy|vacancies)\b/ },
  { id: 'we_need', weight: 1, re: /\bwe need (a|an|two|three|\d+|someone)\b/ },
  { id: 'interview_logistics', weight: 1, re: /\b(walk-in interviews?|closing date|deadline to apply|start date)\b/ },
  { id: 'hiring_hashtag', weight: 2, re: /#(hiring|nowhiring|wearehiring|joinourteam|jobopening|jobopenings)\b/ },
  { id: 'hiring_for', weight: 2, re: /\bhiring (a|an|for|two|three|four|five|\d+|multiple|several|our first|my first)\b/, unless: /(anyone|who'?s|who is|is anyone|are you)\s*$/ },
  { id: 'join_our_team', weight: 2, re: /\b(join (our|my|the) (team|squad|crew|company|group|lab|practice)|come work with (us|me))\b/ },
  { id: 'opens_with_hiring', weight: 2, re: /^(now )?hiring\b(?! (freeze|is|has|managers?|update|process|market|slow))/ },
  { id: 'open_role', weight: 2, re: /\b(open|new|vacant) (role|roles|position|positions|req|reqs|headcount)\b/, unless: /(seeking|looking for|searching for|interested in|started|starting|accepted|begin|beginning|into)\s+(a\s+|an\s+|my\s+)?$/ },
  { id: 'opening', weight: 1, re: /\b(job )?openings?\b/ },
  { id: 'looking_for_to_join', weight: 3, re: /\blooking for (a|an|two|three|\d+|someone|people)\b[^.!?\n]{0,80}\bto (join|lead|help build|own)\b/ },
  { id: 'apply', weight: 2, re: /\b(apply (here|now|via|at|through|below|using|in the|on our)|link to apply|application link|applications? (are |is )?(now )?open)\b/ },
  { id: 'team_growing', weight: 2, re: /\b(team is growing|growing (our|the|my) team|expanding (our|the|my) team|adding to (our|the|my) team|building out (our|the|my) team)\b/ },
  { id: 'send_cv', weight: 1, re: /\b(send|share|dm|email|drop) (me |us )?(your )?(cv|resume|résumé|portfolio)\b/ },
  { id: 'dm_if_interested', weight: 1, re: /\b(dm|message|ping|reach out to|contact) (me|us)\b[^.!?\n]{0,30}\b(if|interested|for (details|more))\b/ },
  { id: 'job_description', weight: 1, re: /\b(job description|jd (in|below|link)|full description|role details)\b/ },
  { id: 'know_someone', weight: 1, re: /\b(know (someone|anyone)|tag (someone|a friend))\b[^.!?\n]{0,50}\b(fit|great|perfect|interested|looking|apply)\b/ },
  { id: 'compensation', weight: 1, re: /\b(salary|compensation|pay range|base pay|equity|benefits include)\b/, unless: /(my|expected|expecting)\s+$/ },

  // ---- hard negatives: the author is looking for work ----
  { id: 'open_to_work', weight: -10, hard: true, re: /(#opentowork\b|\bopen to work\b|\bopen to (new )?(opportunities|roles|offers)\b)/, unless: /(if you'?re|if you are|anyone|candidates who are|people who are|you're)\s*$/ },
  { id: 'looking_for_job', weight: -10, hard: true, re: /\b(i'?m|i am|currently|actively|now)\s+(now\s+|actively\s+|currently\s+)?(looking|searching|seeking)\s+(for\s+)?(a\s+|my next\s+|new\s+|a new\s+|full-time\s+|part-time\s+)?(job|role|position|opportunit(y|ies)|work|contract|gig)\b/ },
  { id: 'next_chapter_seeker', weight: -10, hard: true, re: /\b(looking for|searching for|seeking) my next (role|opportunity|chapter|challenge|position|adventure)\b/ },
  { id: 'laid_off', weight: -10, hard: true, re: /\b(i was|i've been|i have been|i got|i was recently|recently been|unfortunately i was)\s+(laid off|let go|impacted by (the )?(recent )?layoffs?)\b/ },
  { id: 'asking_for_referral', weight: -10, hard: true, re: /\b(refer me|referral for me|please refer|any leads\??|is anyone hiring|anyone hiring\??|who'?s hiring\??|who is hiring\??)/ },

  // ---- soft negatives ----
  { id: 'engagement_bait', weight: -4, re: /(\bcomment\s+["'“]?(interested|yes|me|hire|job|cv)\b|\b(like|repost) (and|&) (share|comment)\b|\bfollow (me|us) for more\b|\bagree\?|\bthoughts\?\s*$)/ },
  { id: 'agency_volume', weight: -3, re: /\b(our clients?|on behalf of (a|our) clients?|multiple clients|recruitment agency|staffing (agency|firm)|we place\b|hundreds of (jobs|roles|openings)|\d{2,}\+? (openings|positions|vacancies|roles) across)\b/ },
  { id: 'new_job_announcement', weight: -3, re: /\b((happy|excited|thrilled|pleased|proud) to (share|announce) (that )?i('?m| am| have|'ve)? ?(started|starting|joined|joining|accepted)|started a new position|starting a new position|new position as)\b/ },
  { id: 'hiring_commentary', weight: -2, re: /\b((hiring managers?|recruiters?|employers) (should|need to|don'?t|never|always|must)|tips for (job seekers|candidates|applicants)|how to get hired|hiring process is broken|ghosted by)\b/ },
  { id: 'hiring_market_news', weight: -2, re: /\b(hiring freeze|hiring (is|has) (slowed|slowing|down|frozen)|layoffs? (at|across|hit))\b/ },
  { id: 'past_hire', weight: -2, re: /\b(we (just )?hired|just hired|welcome (our newest|our new|to the team)|please welcome)\b/ },
  { id: 'role_filled', weight: -3, re: /\b(position|role|req) (has been|is now|is) (filled|closed)\b/ },
];

export const THRESHOLDS = Object.freeze({ likely: 3, unclear: 1 });

const normText = (s) => String(s ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ');

/**
 * @param {string} text
 * @param {string} part  which text the match came from ('text' | 'original')
 */
function matchSignals(text, part) {
  const out = [];
  const t = normText(text);
  if (!t) return out;
  for (const s of SIGNALS) {
    const re = new RegExp(s.re.source, s.re.flags.includes('g') ? s.re.flags : s.re.flags + 'g');
    let m;
    while ((m = re.exec(t)) !== null) {
      const before = t.slice(Math.max(0, m.index - 40), m.index);
      if (!(s.unless && s.unless.test(before))) {
        out.push({ id: s.id, weight: s.weight, hard: Boolean(s.hard), part, match: m[0] });
        break; // each signal counts once per text part
      }
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out;
}

/**
 * Score one post (a normalised Post or {text}).
 * For a repost, the reposter's commentary is scored fully and the original text at half weight,
 * except that hard negatives in the commentary still apply.
 * @param {{text?: string, repost?: {original?: {text?: string|null}}|null}} post
 */
export function scorePost(post) {
  const signals = matchSignals(post.text ?? '', 'text');
  const orig = post.repost?.original?.text;
  if (orig) {
    for (const s of matchSignals(orig, 'original')) {
      if (s.hard) continue; // the original author's situation is not the reposter's
      if (!signals.some((x) => x.id === s.id)) signals.push({ ...s, weight: s.weight / 2 });
    }
  }
  const hard = signals.some((s) => s.hard);
  const score = signals.reduce((a, s) => a + s.weight, 0);
  const label = hard ? 'unlikely' : score >= THRESHOLDS.likely ? 'likely_hiring' : score >= THRESHOLDS.unclear ? 'unclear' : 'unlikely';
  return { score, label, hard_negative: hard, signals };
}

/**
 * Rank posts deterministically: score desc, then urn asc (missing last), then text asc.
 * @template T
 * @param {T[]} posts
 * @param {{filter?: boolean, minScore?: number}} [opts]  filter=true keeps only label "likely_hiring" (or score >= minScore if given)
 */
export function rankPosts(posts, opts = {}) {
  const scored = posts.map((p) => ({ post: p, ...scorePost(p) }));
  scored.sort((a, b) =>
    b.score - a.score
    || cmp(a.post.urn, b.post.urn)
    || String(a.post.text ?? '').localeCompare(String(b.post.text ?? '')));
  if (!opts.filter) return scored;
  if (typeof opts.minScore === 'number') return scored.filter((s) => !s.hard_negative && s.score >= opts.minScore);
  return scored.filter((s) => s.label === 'likely_hiring');
}

function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** One-line explanation, e.g. "+3 we_are_hiring ("we're hiring"); -10 open_to_work (...)" */
export function explain(result) {
  return result.signals.map((s) => `${s.weight > 0 ? '+' : ''}${s.weight} ${s.id}${s.part === 'original' ? '[orig]' : ''} ("${s.match}")`).join('; ') || 'no signals';
}
