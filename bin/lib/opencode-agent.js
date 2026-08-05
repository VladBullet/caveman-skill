'use strict';

// Strip the `tools:` field from a Claude-Code-style subagent frontmatter so
// the file is valid for opencode, whose schema rejects the YAML array form
// (`tools: [Read, Grep, Bash]`) with:
//
//   Configuration is invalid at .../agents/cavecrew-reviewer.md
//   ↳ Expected object | undefined, got ["Read","Grep","Bash"] tools
//
// opencode allows `tools` to be a map (`{read: true, grep: true}`) or
// omitted entirely. Omitting falls back to opencode's default tool set,
// which is what the cavecrew subagent prompts already self-restrict against
// in their body ("Read-only locator", "No `Bash` available", etc.), so
// dropping the array form is safe.

const TOOLS_FIELD_RE = /^tools[ \t]*:/;
const CONTINUATION_RE = /^[ \t]/;
const FRONTMATTER_START_RE = /^---\r?\n/;
const FRONTMATTER_END_RE = /\r?\n---(?:\r?\n|$)/;

function stripOpencodeAgentTools(content) {
  if (typeof content !== 'string') return content;

  const startMatch = content.match(FRONTMATTER_START_RE);
  if (!startMatch) return content;

  const eol = startMatch[0].endsWith('\r\n') ? '\r\n' : '\n';
  const bodyStart = startMatch[0].length;
  const restMatch = content.slice(bodyStart).match(FRONTMATTER_END_RE);
  if (!restMatch || restMatch.index == null) return content;

  const fmEnd = bodyStart + restMatch.index;
  const fm = content.slice(bodyStart, fmEnd);
  const rest = content.slice(fmEnd);

  const out = [];
  let dropping = false;
  for (const line of fm.split(/\r?\n/)) {
    if (dropping) {
      if (CONTINUATION_RE.test(line)) continue;
      dropping = false;
    }
    if (TOOLS_FIELD_RE.test(line)) { dropping = true; continue; }
    out.push(line);
  }

  return `---${eol}${out.join(eol)}${rest}`;
}

module.exports = { stripOpencodeAgentTools };
