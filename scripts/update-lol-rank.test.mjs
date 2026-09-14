import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCurrentRank, updateRank, RIOT_ID } from './update-lol-rank.mjs';

const date = new Date('2026-09-14T00:00:00Z');
const recordRow = ({wins = 126, losses = 125, winRate = 50} = {}) => `<div class="flex flex-col text-right"><span>${wins}<!-- -->승<!-- --> <!-- -->${losses}<!-- -->패</span><span>승률<!-- --> <!-- -->${winRate}<!-- -->%</span></div>`;
const rankRow = (tier, lp, primary = false, record = {}) => `<div><div><div><strong class="${primary ? 'text-xl font-bold' : 'text-sm'}">${tier}</strong>${lp === null ? '' : `<span>${lp}<!-- --> LP</span>`}</div></div>${primary ? (lp === null || record === null ? '' : recordRow(record)) : '<span>최고 티어</span>'}</div>`;
const fixture = ({ current = 90, peak = 104, name = RIOT_ID, tier = '마스터', includeCurrent = true, includePeak = true, record = {} } = {}) =>
  `<h1>${name}</h1><section><div><span>개인/2인 랭크 게임</span></div><aside>최근 10게임${recordRow({wins:7, losses:3, winRate:70})}</aside>${includeCurrent ? rankRow(tier, current, true, record) : ''}${includePeak ? rankRow('마스터', peak) : ''}<table><tr><td>챌린저 999 LP${recordRow({wins:500, losses:500, winRate:50})}</td></tr></table></section><section><span>자유 랭크 게임</span>${rankRow('그랜드마스터', 700, true, {wins:9, losses:1, winRate:90})}${rankRow('챌린저', 900)}</section><script>${rankRow('챌린저', 4000, true)}</script>`;

test('reads current Solo/Duo rank, not peak, Flex, historical data, or scripts', () => {
  const r = parseCurrentRank(fixture(), date);
  assert.equal(r.lp, 90);
  assert.equal(r.tier, 'MASTER');
  assert.equal(r.status, 'ranked');
  assert.equal(r.scope, 'opgg-displayed-solo-current');
  assert.equal(r.queue, 'RANKED_SOLO_5x5');
  assert.equal(r.checkedAt, date.toISOString());
  assert.equal(r.wins, 126);
  assert.equal(r.losses, 125);
  assert.equal(r.winRate, 50);
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
test('explicit unranked current status clears rank, LP, and stats even with a historical peak', () => {
  const r = parseCurrentRank(fixture({tier: '언랭크', current: null}), date);
  assert.equal(r.status, 'unranked');
  assert.equal(r.tier, 'UNRANKED');
  assert.equal(r.division, null);
  assert.equal(r.rankLabel, '언랭크');
  assert.equal(r.lp, null);
  assert.equal(r.wins, null);
  assert.equal(r.losses, null);
  assert.equal(r.winRate, null);
  assert.equal(r.scope, 'opgg-displayed-solo-current');
});
test('accepts OP.GG thousands separators but rejects malformed groups', () => {
  assert.equal(parseCurrentRank(fixture({tier: '챌린저', current: '1,234'})).lp, 1234);
  assert.throws(() => parseCurrentRank(fixture({current: '1,23'})));
});

test('counts and win rate come from the current Solo/Duo row, not Flex or recent games', () => {
  const r = parseCurrentRank(fixture({record:{wins:4, losses:1, winRate:80}}));
  assert.deepEqual([r.wins, r.losses, r.winRate], [4, 1, 80]);
  assert.throws(() => parseCurrentRank(fixture({record:null})));
});

test('accepts grouped match counts and a zero-game record', () => {
  const grouped = parseCurrentRank(fixture({record:{wins:'1,234', losses:'1,000', winRate:55}}));
  assert.deepEqual([grouped.wins, grouped.losses, grouped.winRate], [1234, 1000, 55]);
  const empty = parseCurrentRank(fixture({record:{wins:0, losses:0, winRate:0}}));
  assert.deepEqual([empty.wins, empty.losses, empty.winRate], [0, 0, 0]);
});

test('missing, partial, malformed, or inconsistent current stats reject the entire rank update', () => {
  const validRecord = recordRow();
  const malformed = [
    fixture({record:null}),
    fixture().replace(validRecord, '<div><span>126승 125패</span></div>'),
    fixture().replace(validRecord, '<div><span>승률 50%</span></div>'),
    fixture().replace(validRecord, '<div>unrelated</div>' + validRecord),
    ...[
      {wins:'1,23'}, {losses:'1,25'}, {wins:-1}, {losses:-1}, {wins:1.5},
      {winRate:-1}, {winRate:101}, {winRate:'unknown'}, {winRate:48},
      {wins:0, losses:0, winRate:50},
    ].map(record => fixture({record})),
  ];
  for (const html of malformed) assert.throws(() => parseCurrentRank(html));
  const rounded = parseCurrentRank(fixture({record:{wins:100, losses:100, winRate:49}}));
  assert.equal(rounded.winRate, 49);
  assert.throws(() => parseCurrentRank(fixture({record:{wins:100, losses:100, winRate:48.9}})));
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
  const old = '{"lp":92,"wins":120,"losses":120,"winRate":50}\n';
  try {
    await writeFile(output, old);
    for (const fetchImpl of [
      async () => new Response('blocked', {status:403}),
      async () => new Response('{}', {headers:{'Content-Type':'application/json'}}),
      async () => new Response('<html>challenge</html>', {headers:{'Content-Type':'text/html'}}),
      async () => new Response(fixture({record:null}), {headers:{'Content-Type':'text/html'}}),
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
    assert.deepEqual([saved.wins, saved.losses, saved.winRate], [126, 125, 50]);
  } finally { await rm(dir, {recursive:true}); }
});
