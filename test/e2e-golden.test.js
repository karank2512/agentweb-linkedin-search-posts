// End to end: mock server + client + normalise + dedupe + rank, compared with golden SYNTHETIC snapshots.
// Regenerate deliberately with:  UPDATE_GOLDEN=1 node --test test/e2e-golden.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { runDemo } from '../demo/cli.js';

const golden = (name) => new URL(`./golden/${name}`, import.meta.url);

for (const [name, opts] of [['demo.search-mock.synthetic.json', {}], ['demo.today.synthetic.json', { searchMissing: true }], ['demo.search-mock.billing-block.synthetic.json', { billingStyle: 'block' }]]) {
  test(`golden snapshot: ${name}`, async () => {
    const { summary, lines } = await runDemo(opts);
    assert.ok(lines.every((l) => l.startsWith('[SYNTHETIC]')), 'every demo line is marked synthetic');
    assert.equal(summary.synthetic, true);
    const actual = JSON.parse(JSON.stringify(summary));
    if (process.env.UPDATE_GOLDEN || !existsSync(golden(name))) {
      writeFileSync(golden(name), `${JSON.stringify(actual, null, 2)}\n`);
      if (!process.env.UPDATE_GOLDEN) assert.fail(`golden ${name} was missing and has been written; inspect it and re-run`);
      return;
    }
    assert.deepEqual(actual, JSON.parse(readFileSync(golden(name), 'utf8')));
  });
}

test('billing style does not change the results, only how billing is reported', async () => {
  const top = JSON.parse(readFileSync(golden('demo.search-mock.synthetic.json'), 'utf8'));
  const block = JSON.parse(readFileSync(golden('demo.search-mock.billing-block.synthetic.json'), 'utf8'));
  assert.deepEqual(top.search, block.search);
  assert.deepEqual(top.ledger.entries.map((e) => e.receipt_id), block.ledger.entries.map((e) => e.receipt_id));
  assert.equal(top.ledger.totals.credits_reported, block.ledger.totals.credits_reported);
});
