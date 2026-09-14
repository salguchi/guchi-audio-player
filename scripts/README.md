# Rank updater

From this directory, run `node update-lol-rank.mjs` to refresh `../lol-current-rank.json` from the primary current-rank row of OP.GG's Solo/Duo section.

Run `node --test *.test.mjs` to verify current-vs-peak selection, rank increases and decreases, explicit unranked status, snapshot preservation on failure, and browser updates through `../lol-current-rank-client.js`.

The updater records `scope: "opgg-displayed-solo-current"` with `status: "ranked"` or `"unranked"`. It does not substitute a peak, Flex rank, or historical-season record when the current row is unavailable. The scheduled workflow checks approximately every 15 minutes; the browser checks the published JSON every visible minute. `checkedAt` records the page-fetch time, not a forced OP.GG stats refresh.
