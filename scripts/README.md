# Rank updater

From this directory, run `node update-lol-rank.mjs` to refresh `../lol-current-rank.json` with the current tier, LP, wins, losses, and win rate from the primary current-rank row of OP.GG's Solo/Duo section.

Run `node --test *.test.mjs` to verify current-vs-peak selection, separation from Flex and recent-game stats, rank changes, grouped counts, zero games, explicit unranked status, snapshot preservation on failure, and browser updates through `../lol-current-rank-client.js`.

Ranked snapshots require nonnegative integer `wins` and `losses`, plus numeric `winRate` from 0 to 100. A reported rate more than one percentage point from the win/loss calculation rejects the update. Unranked snapshots use `null` for all three values. Missing or malformed current stats preserve the previous complete snapshot. The client accepts older rank-only snapshots when all three fields are absent and shows a pending-stats message; partial stats are rejected.

The updater records `scope: "opgg-displayed-solo-current"` with `status: "ranked"` or `"unranked"`. It does not substitute a peak, Flex rank, or historical-season record when the current row is unavailable. The scheduled workflow checks approximately every 15 minutes; the browser checks the published JSON every visible minute. `checkedAt` records the page-fetch time, not a forced OP.GG stats refresh.
