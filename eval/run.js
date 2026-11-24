#!/usr/bin/env node
// Evaluation harness for the hiring-intent scorer. SYNTHETIC TEXT ONLY: these numbers say nothing about real LinkedIn posts.
// Positive prediction = label "likely_hiring". "unclear" counts as a negative prediction.

import { pathToFileURL } from 'node:url';
import { EVAL_POSTS } from './posts.synthetic.js';
import { scorePost, explain } from '../src/rank.js';

/** @param {{includeAmbiguous?: boolean, only?: 'heldout'|'tuning'}} [o] */
export function evaluate(o = {}) {
  const set = EVAL_POSTS
    .filter((p) => o.includeAmbiguous !== false || !p.amb)
    .filter((p) => (o.only === 'heldout' ? p.heldout : o.only === 'tuning' ? !p.heldout : true));
  const rows = set.map((p) => {
    const r = scorePost({ text: p.text, repost: p.reshared_text !== undefined ? { original: { text: p.reshared_text } } : null });
    return { ...p, pred: r.label === 'likely_hiring' ? 'H' : 'N', score: r.score, predLabel: r.label, why: explain(r) };
  });
  const tp = rows.filter((r) => r.label === 'H' && r.pred === 'H').length;
  const fp = rows.filter((r) => r.label === 'N' && r.pred === 'H').length;
  const fn = rows.filter((r) => r.label === 'H' && r.pred === 'N').length;
  const tn = rows.filter((r) => r.label === 'N' && r.pred === 'N').length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const byCat = {};
  for (const r of rows) {
    const c = (byCat[r.category] ??= { n: 0, correct: 0, predicted_hiring: 0 });
    c.n++; if (r.pred === r.label) c.correct++; if (r.pred === 'H') c.predicted_hiring++;
  }
  return { n: rows.length, tp, fp, fn, tn, precision, recall, f1, byCat, errors: rows.filter((r) => r.pred !== r.label) };
}

function print(title, e) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  console.log(`\n${title}  (n=${e.n})`);
  console.log(`precision ${pct(e.precision)}  recall ${pct(e.recall)}  F1 ${pct(e.f1)}`);
  console.log('confusion            predicted H   predicted N');
  console.log(`  actual H (hiring)  ${String(e.tp).padStart(11)}   ${String(e.fn).padStart(11)}`);
  console.log(`  actual N (other)   ${String(e.fp).padStart(11)}   ${String(e.tn).padStart(11)}`);
  console.log('per category: correct/n (predicted hiring)');
  for (const [c, v] of Object.entries(e.byCat)) console.log(`  ${c.padEnd(14)} ${v.correct}/${v.n} (${v.predicted_hiring})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log('[SYNTHETIC] Hiring-intent scorer evaluation: synthetic text only, written by the scorer\'s author. Not a measure of real-world accuracy.');
  const all = evaluate({ includeAmbiguous: true });
  const clear = evaluate({ includeAmbiguous: false });
  print('[SYNTHETIC] all posts, including ambiguous', all);
  print('[SYNTHETIC] excluding posts marked ambiguous', clear);
  print('[SYNTHETIC] held-out posts only (written after tuning; small)', evaluate({ only: 'heldout' }));
  console.log('\n[SYNTHETIC] misclassified (all posts):');
  for (const r of all.errors) console.log(`  #${r.id} [${r.category}${r.amb ? ', ambiguous' : ''}] label ${r.label}, got ${r.predLabel} (${r.score}): ${r.text.slice(0, 80)}${r.reshared_text ? ` ⟲ ${r.reshared_text.slice(0, 40)}` : ''}\n      ${r.why}`);
}
