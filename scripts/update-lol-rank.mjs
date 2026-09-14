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
// Fail closed if OP.GG changes this structure; never substitute the peak rank.
export function parseCurrentRank(html, now = new Date()) {
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
  const section = sections[0].split(/<table\b/i)[0];
  // OP.GG's large primary rank is text-xl. The smaller peak row is text-sm.
  // Select it explicitly instead of taking the highest numeric LP or the last row.
  const primary = [...section.matchAll(/<strong\b([^>]*)>([^<]+)<\/strong>/g)]
    .filter((m) => /(?:^|\s)text-xl(?:\s|$)/.test(m[1].match(/\bclass=["']([^"']*)["']/)?.[1] || ''));
  if (primary.length !== 1) throw new Error('Solo/Duo current-rank row is missing or ambiguous.');
  const current = primary[0];
  const rankLabel = plain(current[2]);
  const base = {
    schemaVersion: 1,
    riotId: RIOT_ID,
    queue: 'RANKED_SOLO_5x5',
    scope: 'opgg-displayed-solo-current',
    checkedAt: now.toISOString(),
    source: SOURCE_URL,
  };
  if (/^(언랭크|Unranked)$/i.test(rankLabel)) {
    return { ...base, status: 'unranked', tier: 'UNRANKED', division: null, rankLabel: '언랭크', lp: null, wins: null, losses: null, winRate: null };
  }
  const points = section.slice(current.index + current[0].length).match(
    /^\s*<span\b[^>]*>\s*(\d{1,3}(?:,\d{3})+|\d+)\s*LP\s*<\/span>/,
  );
  if (!points) throw new Error('Current-rank LP is missing or has an unexpected layout.');
  const rank = rankLabel.match(/^(아이언|브론즈|실버|골드|플래티넘|에메랄드|다이아몬드|마스터|그랜드마스터|챌린저)(?:\s+([1-4]|IV|III|II|I))?$/);
  const lp = Number(points[1].replaceAll(',', ''));
  if (!rank || !Number.isInteger(lp) || lp < 0 || lp > 5000) throw new Error('Invalid rank or LP.');
  const tier = TIERS[rank[1]];
  const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier);
  if (apex === Boolean(rank[2])) throw new Error('Invalid tier division.');
  // The two stats spans must immediately follow this current-rank block.
  // Never pick recent-match summaries, the peak row, or Flex queue records.
  const record = section.slice(current.index + current[0].length + points[0].length).match(
    /^(?:\s*<\/div>){2}\s*<div\b[^>]*>\s*<span\b[^>]*>\s*(\d{1,3}(?:,\d{3})+|\d+)\s*승\s*(\d{1,3}(?:,\d{3})+|\d+)\s*패\s*<\/span>\s*<span\b[^>]*>\s*승률\s*(\d+(?:\.\d+)?)\s*%\s*<\/span>\s*<\/div>/,
  );
  if (!record) throw new Error('Current Solo/Duo wins, losses, or win rate is missing.');
  const wins = Number(record[1].replaceAll(',', ''));
  const losses = Number(record[2].replaceAll(',', ''));
  const winRate = Number(record[3]);
  const games = wins + losses;
  if (![wins, losses].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)
      || !Number.isFinite(winRate) || winRate < 0 || winRate > 100
      || (games === 0 ? winRate !== 0 : Math.abs(winRate - wins / games * 100) > 1)) {
    throw new Error('Invalid or inconsistent current Solo/Duo record.');
  }
  return {
    ...base,
    status: 'ranked',
    tier,
    division: rank[2] || null,
    rankLabel,
    lp,
    wins,
    losses,
    winRate,
  };
}

export async function updateRank({ output = new URL('../lol-current-rank.json', import.meta.url), fetchImpl = fetch, now = new Date() } = {}) {
  const response = await fetchImpl(SOURCE_URL, {
    headers: { 'Accept': 'text/html', 'Accept-Language': 'ko-KR,ko;q=0.9', 'User-Agent': 'KimchonaProfile/1.0 (+https://github.com/salguchi/guchi-audio-player)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error(`OP.GG returned an unusable response (${response.status}).`);
  }
  const snapshot = parseCurrentRank(await response.text(), now);
  // Nothing is written until the complete response has passed validation.
  const content = JSON.stringify(snapshot, null, 2) + '\n';
  let existing;
  try { existing = await readFile(output, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing !== content) await writeFile(output, content, 'utf8');
  return snapshot;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  updateRank().then((r) => console.log(`OP.GG Solo/Duo current: ${r.rankLabel}${r.lp === null ? '' : ' ' + r.lp + 'LP'} (checked ${r.checkedAt})`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
