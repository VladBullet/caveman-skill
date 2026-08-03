---
mode: 'agent'
description: 'Generate terse caveman-style commit message for staged changes'
---
<!-- caveman-managed -->
Generate a commit message for the current staged changes.

Format: Conventional Commits — `type(scope): subject`.
- Subject: ≤50 chars, imperative, lowercase after type, no trailing period.
- Body: only when "why" is not obvious from subject. Why over what.
- One blank line between subject and body when body present.

Output the commit message only. No preamble, no commentary.
