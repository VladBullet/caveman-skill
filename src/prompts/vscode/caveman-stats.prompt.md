---
mode: 'agent'
description: 'Show caveman lifetime token-savings stats'
---
<!-- caveman-managed -->
Read the lifetime caveman history log and report total tokens saved, sessions counted, and average compression ratio.

Log location candidates (try in order, use first that exists):
1. `${env:CAVEMAN_HISTORY_PATH}` (if set)
2. `~/.config/caveman/.caveman-history.jsonl`
3. `~/AppData/Roaming/caveman/.caveman-history.jsonl` (Windows)

If no log exists, report `caveman-stats: no history yet` and stop.

Output one short table: `tokens saved | sessions | avg ratio`.
