import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../lol-current-rank-client.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const snapshot = (extra = {}) => ({schemaVersion:1, riotId:'Re 제로부터시작하는다이아생활#탑레마스터', queue:'RANKED_SOLO_5x5', scope:'opgg-displayed-solo-current', status:'ranked', tier:'MASTER', division:null, rankLabel:'마스터', lp:90, wins:126, losses:125, winRate:50, checkedAt:new Date().toISOString(), ...extra});

function browser(data) {
  const elements = {
    'current-rank': {textContent:'마스터 92LP'},
    'current-record': {textContent:'120승 120패 · 승률 50%'},
    'current-icon': {style:{}, hidden:false, src:'lol-master.jpg'},
    'rank-status': {dataset:{checkedAt:'2026-01-01T00:00:00Z'},textContent:''},
  };
  const state = {data, elements, refresh:null, requestedUrls:[]};
  vm.runInNewContext(source, {
    document: {hidden:false, getElementById:(id)=>elements[id], addEventListener:()=>{}},
    fetch: async (url) => { state.requestedUrls.push(url); if (state.data instanceof Error) throw state.data; return {ok:true,json:async()=>state.data}; },
    setInterval: (fn) => { state.refresh=fn; },
    AbortSignal, Intl, Date, Object, Number, Error,
  });
  return state;
}

test('frontend refreshes rank and stats then preserves both when the next fetch fails', async () => {
  const state = browser(snapshot());
  await tick();
  assert.equal(state.elements['current-rank'].textContent,'마스터 90LP');
  assert.equal(state.elements['current-record'].textContent,'126승 125패 · 승률 50%');
  assert.match(state.requestedUrls[0], /\/lol-current-rank\.json\?/);
  state.data = new Error('offline');
  state.refresh();
  await tick();
  assert.equal(state.elements['current-rank'].textContent,'마스터 90LP');
  assert.equal(state.elements['current-record'].textContent,'126승 125패 · 승률 50%');
  assert.match(state.elements['rank-status'].textContent,/자동 확인 실패/);
});
test('frontend rejects old peak scope, invalid identity, rank, queue, or status', async () => {
  for (const data of [snapshot({scope:'opgg-displayed-solo-peak'}), snapshot({riotId:'someone else'}), snapshot({tier:'<script>alert(1)</script>'}), snapshot({lp:-1}), snapshot({queue:'RANKED_FLEX_SR'}), snapshot({division:'I'}), snapshot({status:'unknown'}), snapshot({status:'unranked'}), snapshot({tier:'UNRANKED', lp:null})]) {
    const state = browser(data);
    await tick();
    assert.equal(state.elements['current-rank'].textContent,'마스터 92LP');
    assert.equal(state.elements['current-record'].textContent,'120승 120패 · 승률 50%');
  }
});
test('frontend promotion updates the badge and stale cached data cannot replace a newer rank', async () => {
  const now = new Date();
  const state = browser(snapshot({tier:'GRANDMASTER',lp:400,checkedAt:now.toISOString()}));
  await tick();
  assert.equal(state.elements['current-rank'].textContent,'그랜드마스터 400LP');
  assert.match(state.elements['current-icon'].src,/\/grandmaster\.png$/);
  state.data = snapshot({lp:104, wins:4, losses:1, winRate:80, checkedAt:new Date(now.getTime()-10000).toISOString()});
  state.refresh();
  await tick();
  assert.equal(state.elements['current-rank'].textContent,'그랜드마스터 400LP');
  assert.equal(state.elements['current-record'].textContent,'126승 125패 · 승률 50%');
});

test('frontend accepts newer LP decreases and demotion instead of retaining a peak', async () => {
  const now = Date.now();
  const state = browser(snapshot({lp:104, checkedAt:new Date(now - 2000).toISOString()}));
  await tick();
  state.data = snapshot({lp:75, losses:126, checkedAt:new Date(now - 1000).toISOString()});
  state.refresh();
  await tick();
  assert.equal(state.elements['current-rank'].textContent, '마스터 75LP');
  assert.equal(state.elements['current-record'].textContent, '126승 126패 · 승률 50%');
  state.data = snapshot({tier:'DIAMOND', division:'1', rankLabel:'다이아몬드 1', lp:37, checkedAt:new Date(now).toISOString()});
  state.refresh();
  await tick();
  assert.equal(state.elements['current-rank'].textContent, '다이아몬드 1 37LP');
  assert.match(state.elements['current-icon'].src, /\/diamond\.png$/);
});

test('unranked hides the icon and a later ranked snapshot restores it', async () => {
  const now = Date.now();
  const state = browser(snapshot({status:'unranked', tier:'UNRANKED', division:null, rankLabel:'언랭크', lp:null, wins:null, losses:null, winRate:null, checkedAt:new Date(now - 1000).toISOString()}));
  await tick();
  assert.equal(state.elements['current-rank'].textContent, '언랭크');
  assert.equal(state.elements['current-record'].textContent, '승패·승률 정보 없음');
  assert.ok(state.elements['current-icon'].hidden || state.elements['current-icon'].style.display === 'none');
  state.data = snapshot({lp:0, checkedAt:new Date(now).toISOString()});
  state.refresh();
  await tick();
  assert.equal(state.elements['current-rank'].textContent, '마스터 0LP');
  assert.equal(state.elements['current-icon'].hidden, false);
  assert.notEqual(state.elements['current-icon'].style.display, 'none');
  assert.equal(state.elements['current-icon'].src, 'lol-master.jpg');
  assert.equal(state.elements['current-record'].textContent, '126승 125패 · 승률 50%');
});

test('old rank-only snapshots still update rank while stats wait for the newer publisher', async () => {
  const legacy = snapshot({lp:65});
  delete legacy.wins;
  delete legacy.losses;
  delete legacy.winRate;
  const state = browser(legacy);
  await tick();
  assert.equal(state.elements['current-rank'].textContent, '마스터 65LP');
  assert.equal(state.elements['current-record'].textContent, '승패·승률 확인 중');
  assert.doesNotMatch(state.elements['rank-status'].textContent, /자동 확인 실패/);
});

test('partial, malformed, or inconsistent stats reject both rank and record updates', async () => {
  const partial = snapshot();
  delete partial.winRate;
  const malformed = [partial, ...[
    {wins:null, losses:null, winRate:null}, {wins:'126'}, {losses:125.5}, {wins:-1},
    {winRate:101}, {winRate:-1}, {winRate:48}, {winRate:'50'},
    {wins:0, losses:0, winRate:50},
    {status:'unranked', tier:'UNRANKED', division:null, lp:null, wins:0, losses:0, winRate:0},
  ].map(extra => snapshot(extra))];
  for (const data of malformed) {
    const state = browser(data);
    await tick();
    assert.equal(state.elements['current-rank'].textContent, '마스터 92LP');
    assert.equal(state.elements['current-record'].textContent, '120승 120패 · 승률 50%');
    assert.match(state.elements['rank-status'].textContent, /자동 확인 실패/);
  }
});

test('ranked zero-game stats remain actual zero values and large counts remain visible', async () => {
  const state = browser(snapshot({wins:0, losses:0, winRate:0}));
  await tick();
  assert.equal(state.elements['current-record'].textContent, '0승 0패 · 승률 0%');
  const large = browser(snapshot({wins:1234, losses:1000, winRate:55}));
  await tick();
  assert.equal(large.elements['current-record'].textContent.replaceAll(',', ''), '1234승 1000패 · 승률 55%');
});
