import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const RIOT_ID = 'Re 제로부터시작하는다이아생활#탑레마스터';
export const SOURCE_URL = 'https://op.gg/ko/lol/summoners/kr/' + encodeURIComponent('Re 제로부터시작하는다이아생활-탑레마스터');
export const TIERS = {
  아이언: 'IRON', 브론즈: 'BRONZE', 실버: 'SILVER', 골드: 'GOLD',
  플래티넘: 'PLATINUM', 에메랄드: 'EMERALD', 다이아몬드: 'DIAMOND',
  마스터: 'MASTER', 그랜드마스터: 'GRANDMASTER', 챌린저: 'CHALLENGER',
};

const plain = (s) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ').trim();
const compact = (s) => plain(s).replace(/\s/g, '');

// Only use server-rendered profile markup, never React payloads or historical seasons.
// Fail closed if OP.GG changes this structure; never substitute the current rank.
export function parsePeak(html, now = new Date()) {
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const headings = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (!headings.some((h) => compact(h[1]) === compact(RIOT_ID))) {
    throw new Error('Expected OP.GG profile was not found. Keeping the saved rank.');
  }
  const sections = [...markup.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)]
    .map((m) => m[1]).filter((s) => /<span\b[^>]*>\s*개인\/2인 랭크 게임\s*<\/span>/.test(s));
  if (sections.length !== 1) throw new Error('Solo/Duo section is missing or ambiguous.');
  const section = sections[0];
  const labels = [...section.matchAll(/<span\b[^>]*>\s*최고 티어\s*<\/span>/g)];
  if (labels.length !== 1) throw new Error('Solo/Duo highest-rank label is missing or ambiguous.');
  // The tier and LP must be in the rank row immediately adjoining the peak label.
  const peak = section.slice(0, labels[0].index).match(
    /<strong\b[^>]*>([^<]+)<\/strong>\s*<span\b[^>]*>\s*(\d{1,3}(?:,\d{3})+|\d+)\s*LP\s*<\/span>(?:\s*<\/div>){1,6}\s*$/,
  );
  if (!peak) throw new Error('Highest-rank row has an unexpected layout.');
  const rank = plain(peak[1]).match(/^(아이언|브론즈|실버|골드|플래티넘|에메랄드|다이아몬드|마스터|그랜드마스터|챌린저)(?:\s+([1-4]|IV|III|II|I))?$/);
  const lp = Number(peak[2].replaceAll(',', ''));
  if (!rank || !Number.isInteger(lp) || lp < 0 || lp > 5000) throw new Error('Invalid rank or LP.');
  const tier = TIERS[rank[1]];
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier);
  if (apex === Boolean(rank[2])) throw new Error('Invalid tier division.');
  return {
    schemaVersion: 1,
    riotId: RIOT_ID,
    queue: 'RANKED_SOLO_5x5',
    scope: 'opgg-displayed-solo-peak',
    tier,
    division: rank[2] || null,
    rankLabel: plain(peak[1]),
    lp,
    checkedAt: now.toISOString(),
    source: SOURCE_URL,
  };
}

export async function updateRank({ output = new URL('../lol-rank.json', import.meta.url), fetchImpl = fetch, now = new Date() } = {}) {
  const response = await fetchImpl(SOURCE_URL, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9', 'User-Agent': 'KimchonaProfile/1.0 (+https://github.com/salguchi/guchi-audio-player)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`OP.GG returned an unusable response (${response.status}).`);
  }
  const snapshot = parsePeak(await response.text(), now);
  // Nothing is written until the complete response has passed validation.
  const content = JSON.stringify(snapshot, null, 2) + '\n';
  let existing;
  try { existing = await readFile(output, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing !== content) await writeFile(output, content, 'utf8');
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateRank().then((r) => console.log(`OP.GG Solo/Duo peak: ${r.rankLabel} ${r.lp}LP (checked ${r.checkedAt})`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
