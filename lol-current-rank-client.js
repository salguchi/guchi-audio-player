(() => {
  'use strict';
  const dataUrl = 'https://raw.githubusercontent.com/salguchi/guchi-audio-player/main/lol-current-rank.json';
  const expectedId = 'Re 제로부터시작하는다이아생활#탑레마스터';
  const tiers = { IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘', EMERALD: '에메랄드', DIAMOND: '다이아몬드', MASTER: '마스터', GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저' };
  const label = document.getElementById('current-rank');
  const icon = document.getElementById('current-icon');
  const status = document.getElementById('rank-status');
  const record = document.getElementById('current-record');
  let lastChecked = Date.parse(status.dataset.checkedAt);
  let displayedTier = 'MASTER';
  let loading = false;
  const format = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

  function showStatus(failed = false) {
    const stale = !Number.isFinite(lastChecked) || Date.now() - lastChecked > 2 * 60 * 60 * 1000;
    const prefix = failed ? '자동 확인 실패 · ' : stale ? '확인 지연 · ' : '';
    status.textContent = prefix + (Number.isFinite(lastChecked) ? format.format(lastChecked) + ' 확인' : '저장된 기록');
  }

  async function refreshRank() {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch(dataUrl + '?t=' + Date.now(), { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Rank data unavailable');
      const data = await response.json();
      const checked = Date.parse(data.checkedAt);
      const knownTier = Object.hasOwn(tiers, data.tier);
      const apex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(data.tier);
      const validDivision = apex ? data.division === null : typeof data.division === 'string' && /^(?:[1-4]|I|II|III|IV)$/.test(data.division);
      const ranked = data.status === 'ranked' && knownTier && validDivision && Number.isInteger(data.lp) && data.lp >= 0 && data.lp <= 5000;
      const unranked = data.status === 'unranked' && data.tier === 'UNRANKED' && data.division === null && data.lp === null;
      if (data.schemaVersion !== 1 || data.riotId !== expectedId || data.queue !== 'RANKED_SOLO_5x5' || data.scope !== 'opgg-displayed-solo-current' || (!ranked && !unranked) || !Number.isFinite(checked) || checked > Date.now() + 300000) {
        throw new Error('Invalid current-rank snapshot');
      }
      // Accept the old rank-only format during deployment, never partial stats.
      const hasStats = ['wins', 'losses', 'winRate'].some((key) => Object.hasOwn(data, key));
      const games = data.wins + data.losses;
      const validStats = unranked
        ? data.wins === null && data.losses === null && data.winRate === null
        : [data.wins, data.losses].every((n) => Number.isInteger(n) && n >= 0 && n <= 100000)
          && Number.isFinite(data.winRate) && data.winRate >= 0 && data.winRate <= 100
          && (games === 0 ? data.winRate === 0 : Math.abs(data.winRate - data.wins / games * 100) <= 1);
      if (hasStats && !validStats) throw new Error('Invalid current Solo/Duo record');
      // Timestamp ordering prevents stale responses, but lower LP is a valid update.
      if (checked >= lastChecked || !Number.isFinite(lastChecked)) {
        const tierName = unranked ? '언랭크' : tiers[data.tier] + (data.division ? ' ' + data.division : '');
        label.textContent = unranked ? tierName : tierName + ' ' + data.lp + 'LP';
        if (record) record.textContent = unranked ? '승패·승률 정보 없음'
          : hasStats ? data.wins + '승 ' + data.losses + '패 · 승률 ' + data.winRate + '%'
          : '승패·승률 확인 중';
        if (displayedTier !== data.tier) {
          icon.hidden = unranked;
          icon.style.display = unranked ? 'none' : '';
          icon.onerror = () => { icon.style.display = 'none'; };
          icon.alt = tierName + ' 티어';
          if (!unranked) icon.src = data.tier === 'MASTER' ? 'lol-master.jpg' : 'https://opgg-static.akamaized.net/images/medals_new/' + data.tier.toLowerCase() + '.png';
          displayedTier = data.tier;
        }
        lastChecked = checked;
      }
      showStatus();
    } catch (error) {
      showStatus(true);
    } finally { loading = false; }
  }

  refreshRank();
  setInterval(() => { if (!document.hidden) refreshRank(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshRank(); });
})();
