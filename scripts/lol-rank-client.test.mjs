import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../lol-rank-client.js', import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const snapshot = (extra = {}) => ({schemaVersion:1, riotId:'Re 제로부터시작하는다이아생활#탑레마스터', queue:'RANKED_SOLO_5x5', scope:'opgg-displayed-solo-peak', tier:'MASTER', division:null, lp:104, checkedAt:new Date().toISOString(), ...extra});

function browser(data) {
  const elements = {
    'peak-rank': {textContent:'마스터 92LP'},
    'peak-icon': {style:{}, src:'lol-master.jpg'},
    'rank-status': {dataset:{checkedAt:'2026-01-01T00:00:00Z'},textContent:''},
  };
  const state = {data, elements, refresh:null};
  vm.runInNewContext(source, {
    document: {hidden:false, getElementById:(id)=>elements[id], addEventListener:()=>{}},
    fetch: async () => { if (state.data instanceof Error) throw state.data; return {ok:true,json:async()=>state.data}; },
    setInterval: (fn) => { state.refresh=fn; },
    AbortSignal, Intl, Date, Object, Number, Error,
  });
  return state;
}

test('frontend refreshes LP then preserves it when the next fetch fails', async () => {
  const state = browser(snapshot());
  await tick();
  assert.equal(state.elements['peak-rank'].textContent,'마스터 104LP');
  state.data = new Error('offline');
  state.refresh();
  await tick();
  assert.equal(state.elements['peak-rank'].textContent,'마스터 104LP');
  assert.match(state.elements['rank-status'].textContent,/자동 확인 실패/);
});
test('frontend validates identity and tier and does not render arbitrary HTML', async () => {
  for (const data of [snapshot({riotId:'someone else'}), snapshot({tier:'<script>alert(1)</script>'}), snapshot({lp:-1}), snapshot({queue:'RANKED_FLEX_SR'}),snapshot({division:'I'})]) {
    const state = browser(data);
    await tick();
    assert.equal(state.elements['peak-rank'].textContent,'마스터 92LP');
  }
});
test('frontend promotion updates the badge and stale cached data cannot roll back a newer score', async () => {
  const now = new Date();
  const state = browser(snapshot({tier:'GRANDMASTER',lp:400,checkedAt:now.toISOString()}));
  await tick();
  assert.equal(state.elements['peak-rank'].textContent,'그랜드마스터 400LP');
  assert.match(state.elements['peak-icon'].src,/\/grandmaster\.png$/);
  state.data = snapshot({lp:104, checkedAt:new Date(now.getTime()-10000).toISOString()});
  state.refresh();
  await tick();
  assert.equal(state.elements['peak-rank'].textContent,'그랜드마스터 400LP');
});
