---
mode: 'agent'
description: 'Compress a markdown/text file into caveman style (preserves code, links, paths)'
---
<!-- caveman-managed -->
Compress the file the user names after the slash command into terse caveman style.

Rewrite prose:
- Drop articles, filler, hedging. Fragments OK.
- Preserve exactly: code blocks, inline code, URLs, file paths, commands, headings, list structure, tables.
- Preserve all technical content. Cuts must be lossless on substance.

Before overwrite, save the original to `<file>.original.md` if no backup exists yet.

Refuse non-prose files: `.py`, `.js`, `.ts`, `.json`, `.yaml`, `.yml`, `.toml`, `.sh`, `.ps1`, etc. Only act on `.md`, `.txt`, `.typ`, `.tex`, or extensionless prose.
Refuse to compress an existing `*.original.md` backup.
