import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePeak, updateRank, RIOT_ID } from './update-lol-rank.mjs';

const date = new Date('2026-09-14T00:00:00Z');
const rankRow = (tier, lp, label = '') => `<div><div><div><strong class="text-sm">${tier}</strong><span>${lp}<!-- --> LP</span></div></div>${label ? `<span>${label}</span>` : ''}</div>`;
const fixture = ({ current = 90, peak = 104, name = RIOT_ID, tier = '마스터', label = '최고 티어' } = {}) =>
  `<h1>${name}</h1><section><div><span>개인/2인 랭크 게임</span></div>${rankRow('마스터', current)}${rankRow(tier, peak, label)}<table><tr><td>챌린저 999 LP</td></tr></table></section><section><span>자유 랭크 게임</span>${rankRow('그랜드마스터', 700, '최고 티어')}</section><script>"최고 티어"</script>`;

test('reads the Solo/Duo peak, not current, Flex, historical data, or scripts', () => {
  const r = parsePeak(fixture(), date);
  assert.equal(r.lp, 104);
  assert.equal(r.tier, 'MASTER');
  assert.equal(r.checkedAt, date.toISOString());
});
test('does not substitute a numerically higher current rank', () => assert.equal(parsePeak(fixture({current: 200})).lp, 104));
test('accepts OP.GG thousands separators but rejects malformed groups', () => {
  assert.equal(parsePeak(fixture({tier: '챌린저', peak: '1,234'})).lp, 1234);
  assert.throws(() => parsePeak(fixture({peak: '1,23'})));
});
test('accepts 0 LP and promotion with a changed tier', () => {
  assert.equal(parsePeak(fixture({peak: 0})).lp, 0);
  assert.equal(parsePeak(fixture({tier: '그랜드마스터', peak: 500})).tier, 'GRANDMASTER');
});
test('accepts valid lower tier divisions; reflects source resets instead of inventing a lifetime peak', () => {
  assert.equal(parsePeak(fixture({tier: '다이아몬드 1', peak: 37})).division, '1');
});
test('rejects missing peak, duplicate peak, wrong profile, invalid tier, malformed row, and challenge pages', () => {
  for (const html of [fixture({label: ''}), fixture({name: '다른소환사#KR1'}), fixture({tier: 'UNKNOWN'}), fixture({tier:'마스터 1'}), fixture({tier:'다이아몬드'}), fixture({peak: 99999}), '<html>Verify you are human</html>', fixture().replace('<span>최고 티어</span>', '<span>최고 티어</span><span>최고 티어</span>'), fixture().replace('<span>최고 티어</span>', '<p>unrelated content</p><span>최고 티어</span>')]) {
    assert.throws(() => parsePeak(html));
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
    assert.equal(JSON.parse(await readFile(output, 'utf8')).lp, 104);
  } finally { await rm(dir, {recursive:true}); }
});
