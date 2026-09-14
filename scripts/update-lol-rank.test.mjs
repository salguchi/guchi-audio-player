import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCurrentRank, updateRank, RIOT_ID } from './update-lol-rank.mjs';

const date = new Date('2026-09-14T00:00:00Z');
const rankRow = (tier, lp, primary = false) => `<div><div><div><strong class="${primary ? 'text-xl font-bold' : 'text-sm'}">${tier}</strong>${lp === null ? '' : `<span>${lp}<!-- --> LP</span>`}</div></div>${primary ? '<div>358승 340패 승률 51%</div>' : '<span>최고 티어</span>'}</div>`;
const fixture = ({ current = 90, peak = 104, name = RIOT_ID, tier = '마스터', includeCurrent = true, includePeak = true } = {}) =>
  `<h1>${name}</h1><section><div><span>개인/2인 랭크 게임</span></div>${includeCurrent ? rankRow(tier, current, true) : ''}${includePeak ? rankRow('마스터', peak) : ''}<table><tr><td>챌린저 999 LP</td></tr></table></section><section><span>자유 랭크 게임</span>${rankRow('그랜드마스터', 700, true)}${rankRow('챌린저', 900)}</section><script>${rankRow('챌린저', 4000, true)}</script>`;

test('reads current Solo/Duo rank, not peak, Flex, historical data, or scripts', () => {
  const r = parseCurrentRank(fixture(), date);
  assert.equal(r.lp, 90);
  assert.equal(r.tier, 'MASTER');
  assert.equal(r.status, 'ranked');
  assert.equal(r.scope, 'opgg-displayed-solo-current');
  assert.equal(r.queue, 'RANKED_SOLO_5x5');
  assert.equal(r.checkedAt, date.toISOString());
});
test('reflects current LP above or below the displayed peak', () => {
  for (const current of [75, 200]) assert.equal(parseCurrentRank(fixture({current})).lp, current);
});
test('current rank remains valid when the peak row is absent', () => {
  assert.equal(parseCurrentRank(fixture({includePeak: false})).lp, 90);
});
test('missing current rank must not fall back to the peak row', () => {
  assert.throws(() => parseCurrentRank(fixture({includeCurrent: false})));
  assert.throws(() => parseCurrentRank(fixture().replace('text-xl font-bold', 'text-sm')));
  assert.throws(() => parseCurrentRank(fixture({current: null})));
});
test('explicit unranked current status clears rank and LP even with a historical peak', () => {
  const r = parseCurrentRank(fixture({tier: '언랭크', current: null}), date);
  assert.equal(r.status, 'unranked');
  assert.equal(r.tier, 'UNRANKED');
  assert.equal(r.division, null);
  assert.equal(r.rankLabel, '언랭크');
  assert.equal(r.lp, null);
  assert.equal(r.scope, 'opgg-displayed-solo-current');
});
test('accepts OP.GG thousands separators but rejects malformed groups', () => {
  assert.equal(parseCurrentRank(fixture({tier: '챌린저', current: '1,234'})).lp, 1234);
  assert.throws(() => parseCurrentRank(fixture({current: '1,23'})));
});
test('accepts 0 LP and promotion with a changed tier', () => {
  assert.equal(parseCurrentRank(fixture({current: 0})).lp, 0);
  assert.equal(parseCurrentRank(fixture({tier: '그랜드마스터', current: 500})).tier, 'GRANDMASTER');
});
test('accepts valid lower tier divisions', () => {
  assert.equal(parseCurrentRank(fixture({tier: '다이아몬드 1', current: 37})).division, '1');
});
test('rejects ambiguous current rank, wrong profile, invalid tier or LP, malformed rows, and challenge pages', () => {
  for (const html of [fixture({name: '다른소환사#KR1'}), fixture({tier: 'UNKNOWN'}), fixture({tier:'마스터 1'}), fixture({tier:'다이아몬드'}), fixture({current: 99999}), fixture({current: -1}), '<html>Verify you are human</html>', fixture().replace('<table>', rankRow('마스터', 30, true) + '<table>'), fixture().replace('<span>90<!-- --> LP</span>', '<p>unrelated content</p><span>90 LP</span>')]) {
    assert.throws(() => parseCurrentRank(html));
  }
});
test('failed HTTP, content type, validation, or network leaves snapshot unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chona-rank-test-'));
  const output = join(dir, 'rank.json');
  const old = '{"lp":92}\n';
  try {
    await writeFile(output, old);
    for (const fetchImpl of [
      async () => new Response('blocked', {status:403}),
      async () => new Response('{}', {headers:{'Content-Type':'application/json'}}),
      async () => new Response('<html>challenge</html>', {headers:{'Content-Type':'text/html'}}),
      async () => { throw new Error('network error'); },
    ]) {
      await assert.rejects(updateRank({output, fetchImpl}));
      assert.equal(await readFile(output, 'utf8'), old);
    }
    await updateRank({output, now:date, fetchImpl: async () => new Response(fixture(), {headers:{'Content-Type':'text/html'}})});
    const saved = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(saved.lp, 90);
    assert.equal(saved.scope, 'opgg-displayed-solo-current');
    assert.equal(saved.status, 'ranked');
  } finally { await rm(dir, {recursive:true}); }
});
