(() => {
  'use strict';
  const dataUrl = 'https://raw.githubusercontent.com/salguchi/guchi-audio-player/main/lol-rank.json';
  const expectedId = 'Re 제로부터시작하는다이아생활#탑레마스터';
  const tiers = { IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘', EMERALD: '에메랄드', DIAMOND: '다이아몬드', MASTER: '마스터', GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저' };
  const label = document.getElementById('peak-rank');
  const icon = document.getElementById('peak-icon');
  const status = document.getElementById('rank-status');
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
      const validDivision = apex ? data.division === null : /^(?:[1-4]|I|II|III|IV)$/.test(data.division);
      if (data.schemaVersion !== 1 || data.riotId !== expectedId || data.queue !== 'RANKED_SOLO_5x5' || data.scope !== 'opgg-displayed-solo-peak' || !knownTier || !validDivision || !Number.isInteger(data.lp) || data.lp < 0 || data.lp > 5000 || !Number.isFinite(checked) || checked > Date.now() + 300000) {
        throw new Error('Invalid rank snapshot');
      }
      // A stale CDN response must never replace a newer verified display.
      if (checked >= lastChecked || !Number.isFinite(lastChecked)) {
        const tierName = tiers[data.tier] + (data.division ? ' ' + data.division : '');
        label.textContent = tierName + ' ' + data.lp + 'LP';
        if (displayedTier !== data.tier) {
          icon.hidden = false;
          icon.style.display = '';
          icon.onerror = () => { icon.style.display = 'none'; };
          icon.alt = tierName + ' 티어';
          icon.src = data.tier === 'MASTER' ? 'lol-master.jpg' : 'https://opgg-static.akamaized.net/images/medals_new/' + data.tier.toLowerCase() + '.png';
          displayedTier = data.tier;
        }
        lastChecked = checked;
      }
      showStatus();
    } catch (error) {
      // Preserve the last valid score on network or source failures.
      showStatus(true);
    } finally { loading = false; }
  }

  refreshRank();
  setInterval(() => { if (!document.hidden) refreshRank(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshRank(); });
})();
