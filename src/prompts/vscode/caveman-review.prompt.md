---
mode: 'agent'
description: 'One-line caveman code review of current changes'
---
<!-- caveman-managed -->
Review the current code changes (staged diff, current selection, or named file if user provided one).

Format: one line per finding.
`L<line>: <severity> <problem>. <fix>.`

Severity: `bug` | `risk` | `nit` | `q`.

Skip praise. Skip obvious. If code looks good, output `LGTM` and stop.
