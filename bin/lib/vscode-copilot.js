// caveman → VS Code Copilot (user-scope) install / uninstall helper.
//
// VS Code Copilot auto-loads every `*.instructions.md` file from the user's
// `~/.copilot/instructions/` folder into every chat session, in every
// workspace, with no per-repo setup. A file without an `applyTo` frontmatter
// key is treated as always-on, which is exactly the behavior we want for
// caveman: type once, no `/caveman` per session, no per-repo init.
//
// This is intentionally narrower than the existing `copilot` provider in
// install.js, which writes the per-repo `.github/copilot-instructions.md`
// via src/tools/caveman-init.js. The two providers serve different use cases:
//
//   --only copilot --with-init  →  per-repo, this workspace only
//   --only vscode               →  user-scope, every workspace, no init
//
// One write. One file. Idempotent. Uninstall removes the same file.
//
// File path resolution:
//   Linux/macOS/Windows: <homedir>/.copilot/instructions/caveman.instructions.md
//
// Override for tests/non-default setups: pass `{ root }` to the helpers, or
// set CAVEMAN_VSCODE_USER_ROOT in the environment.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTR_FILENAME = 'caveman.instructions.md';
const MARK_BEGIN = '<!-- caveman-begin -->';
const MARK_END = '<!-- caveman-end -->';

function resolveRoot(env = process.env) {
  if (env.CAVEMAN_VSCODE_USER_ROOT) return path.resolve(env.CAVEMAN_VSCODE_USER_ROOT);
  return path.join(os.homedir(), '.copilot');
}

function resolveInstructionsFile(root) {
  return path.join(root || resolveRoot(), 'instructions', INSTR_FILENAME);
}

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

// Load the canonical caveman activation rule body. Prefer the in-repo source
// of truth so the file stays in sync with what other agents see; fall back to
// an embedded copy when run standalone (curl|node, no repo on disk).
function loadRuleBody(repoRoot) {
  if (repoRoot) {
    const body = readIfExists(path.join(repoRoot, 'src', 'rules', 'caveman-activate.md'));
    if (body) return body.trimEnd() + '\n';
  }
  return [
    'Respond terse like smart caveman. All technical substance stay. Only fluff die.',
    '',
    'Rules:',
    '- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging',
    '- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.',
    '- Pattern: [thing] [action] [reason]. [next step].',
    '- Not: "Sure! I\'d be happy to help you with that."',
    '- Yes: "Bug in auth middleware. Fix:"',
    '',
    'Switch level: /caveman lite|full|ultra|wenyan',
    'Stop: "stop caveman" or "normal mode"',
    '',
    'Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.',
    '',
    'Boundaries: code/commits/PRs written normal.',
    '',
  ].join('\n');
}

// Build the full file body. VS Code Copilot instruction files use YAML
// frontmatter; omitting `applyTo` makes the rule load for every session in
// every workspace (always-on). The body is wrapped in marker fences so a
// future uninstall can locate and remove the block even if the user has
// edited the file (we still default to deleting the whole file when it's
// ours — markers are belt-and-suspenders for shared-file scenarios).
function buildFileContent(ruleBody) {
  const frontmatter = [
    '---',
    "name: 'Caveman mode'",
    "description: 'Terse caveman-style responses — ~75% fewer output tokens, full technical accuracy. Always-on, user-scope.'",
    '---',
    '',
  ].join('\n');
  return frontmatter + MARK_BEGIN + '\n' + ruleBody.trimEnd() + '\n' + MARK_END + '\n';
}

function noopLog() {
  return { write: () => {}, note: () => {}, warn: () => {} };
}

function installVscode({ root, repoRoot, dryRun = false, force = false, log = noopLog() } = {}) {
  const target = resolveInstructionsFile(root);
  const ruleBody = loadRuleBody(repoRoot);
  const content = buildFileContent(ruleBody);

  if (dryRun) {
    log.note(`  would write ${target}`);
    return { ok: true, dryRun: true, path: target };
  }

  if (fs.existsSync(target) && !force) {
    const existing = readIfExists(target);
    if (existing && existing.includes(MARK_BEGIN) && existing.includes(MARK_END)) {
      // Refresh content — keeps the file in sync with the latest rule body
      // when caveman is upgraded. Same-content writes are no-ops at the FS
      // level on most filesystems; skip the write if bytes are identical.
      if (existing === content) {
        log.note(`  ${target} already up to date`);
        return { ok: true, alreadyInstalled: true, path: target };
      }
      fs.writeFileSync(target, content, { mode: 0o644 });
      log.write(`  refreshed ${target}\n`);
      return { ok: true, refreshed: true, path: target };
    }
    log.warn(`  ${target} exists without caveman markers — refusing to overwrite. Re-run with --force to replace.`);
    return { ok: false, reason: 'file exists without markers' };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode: 0o644 });
  log.write(`  installed: ${target}\n`);
  return { ok: true, path: target };
}

function uninstallVscode({ root, dryRun = false, log = noopLog() } = {}) {
  const target = resolveInstructionsFile(root);
  if (!fs.existsSync(target)) return { ok: true, touched: false };

  const body = readIfExists(target) || '';
  const isOurs = body.includes(MARK_BEGIN) && body.includes(MARK_END);

  if (!isOurs) {
    log.warn(`  ${target} exists but lacks caveman markers — leaving in place. Remove manually if it's ours.`);
    return { ok: true, touched: false, skipped: true };
  }

  if (dryRun) {
    log.note(`  would remove ${target}`);
    return { ok: true, touched: true, dryRun: true };
  }

  try { fs.unlinkSync(target); } catch (_) {}
  log.note(`  removed ${target}`);
  return { ok: true, touched: true };
}

module.exports = {
  installVscode,
  uninstallVscode,
  resolveRoot,
  resolveInstructionsFile,
  // exported for tests
  buildFileContent,
  loadRuleBody,
  INSTR_FILENAME,
  MARK_BEGIN,
  MARK_END,
};
