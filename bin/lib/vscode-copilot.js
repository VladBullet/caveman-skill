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
//
// In addition to the always-on instructions file, we also install per-slash
// prompt files (`*.prompt.md`) into the VS Code Copilot user prompts folder
// so `/caveman`, `/caveman-commit`, etc. show up in the chat slash-menu with
// autocomplete. Source of truth: `src/prompts/vscode/*.prompt.md`. Each
// shipped prompt carries a `<!-- caveman-managed -->` sentinel so uninstall
// can identify and safely delete them without touching user-authored prompts.
//
// Prompts dir resolution (override with CAVEMAN_VSCODE_PROMPTS_DIR):
//   Windows: %APPDATA%/Code/User/prompts
//   macOS:   ~/Library/Application Support/Code/User/prompts
//   Linux:   $XDG_CONFIG_HOME/Code/User/prompts (fallback ~/.config/Code/User/prompts)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTR_FILENAME = 'caveman.instructions.md';
const MARK_BEGIN = '<!-- caveman-begin -->';
const MARK_END = '<!-- caveman-end -->';
const PROMPT_SENTINEL = '<!-- caveman-managed -->';
const PROMPT_FILES = [
  'caveman.prompt.md',
  'caveman-commit.prompt.md',
  'caveman-review.prompt.md',
  'caveman-compress.prompt.md',
  'caveman-help.prompt.md',
  'caveman-stats.prompt.md',
];

// Valid persistent default levels for `--level <name>`. `disabled` is a
// special routed-to-uninstall value handled by the caller, not written into
// the file.
const VALID_LEVELS = ['lite', 'full', 'ultra', 'wenyan', 'wenyan-lite', 'wenyan-ultra'];
const VALID_LEVELS_PLUS_DISABLED = VALID_LEVELS.concat(['disabled']);

function resolveRoot(env = process.env) {
  if (env.CAVEMAN_VSCODE_USER_ROOT) return path.resolve(env.CAVEMAN_VSCODE_USER_ROOT);
  return path.join(os.homedir(), '.copilot');
}

function resolveInstructionsFile(root) {
  return path.join(root || resolveRoot(), 'instructions', INSTR_FILENAME);
}

// VS Code Copilot loads `*.prompt.md` files from a per-user `prompts/`
// folder under the VS Code user-data directory. The location is platform
// dependent. Honor an explicit override first.
function resolvePromptsDir(env = process.env, platform = process.platform) {
  if (env.CAVEMAN_VSCODE_PROMPTS_DIR) return path.resolve(env.CAVEMAN_VSCODE_PROMPTS_DIR);
  const home = os.homedir();
  if (platform === 'win32') {
    const appdata = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appdata, 'Code', 'User', 'prompts');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'prompts');
  }
  const xdg = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(xdg, 'Code', 'User', 'prompts');
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
    'Switch level: /caveman lite|full|ultra|wenyan|wenyan-lite|wenyan-ultra',
    'Stop: /caveman disabled, "stop caveman", or "normal mode"',
    '',
    'Default intensity: full.',
    '',
    'Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.',
    '',
    'Boundaries: code/commits/PRs written normal.',
    '',
  ].join('\n');
}

// Replace the "Default intensity: <X>." line with the requested level. The
// rule body always contains a baseline "Default intensity: full." line; we
// rewrite it in place so the rest of the rule stays byte-equivalent.
function applyLevel(ruleBody, level) {
  if (!level || level === 'full') return ruleBody;
  return ruleBody.replace(/^Default intensity: .+\.$/m, `Default intensity: ${level}.`);
}

// Build the full file body. VS Code Copilot instruction files use YAML
// frontmatter. We set `applyTo: '**'` so the rule applies to every file
// context (and therefore every chat turn that has any file context). Without
// `applyTo`, VS Code treats the file as on-demand description-matched, which
// would not give us the always-on behavior we want for a tone/style rule.
// The body is wrapped in marker fences so a future uninstall can locate
// and remove the block even if the user has edited the file (we still
// default to deleting the whole file when it's ours — markers are
// belt-and-suspenders for shared-file scenarios).
function buildFileContent(ruleBody) {
  const frontmatter = [
    '---',
    "name: 'Caveman mode'",
    "description: 'Terse caveman-style responses — ~75% fewer output tokens, full technical accuracy.'",
    "applyTo: '**'",
    '---',
    '',
  ].join('\n');
  return frontmatter + MARK_BEGIN + '\n' + ruleBody.trimEnd() + '\n' + MARK_END + '\n';
}

function noopLog() {
  return { write: () => {}, note: () => {}, warn: () => {} };
}

// Read a prompt file body — prefer the in-repo source of truth, fall back to
// a minimal embedded stub so a curl|node install (no repo on disk) still
// drops working slash commands. The embedded stubs match the bodies in
// `src/prompts/vscode/*.prompt.md`; keep them in sync if you edit either.
function loadPromptBody(repoRoot, filename) {
  if (repoRoot) {
    const p = path.join(repoRoot, 'src', 'prompts', 'vscode', filename);
    const body = readIfExists(p);
    if (body) return body.trimEnd() + '\n';
  }
  return EMBEDDED_PROMPTS[filename] || null;
}

const EMBEDDED_PROMPTS = {
  'caveman.prompt.md': [
    "---",
    "mode: 'agent'",
    "description: 'Switch caveman intensity (lite/full/ultra/wenyan/wenyan-lite/wenyan-ultra/off)'",
    "---",
    PROMPT_SENTINEL,
    "Switch caveman to the level given after the slash (`lite`, `full`, `ultra`, `wenyan`, `wenyan-lite`, `wenyan-ultra`). If no level given, use `full`. If `off`/`disabled`/`stop`, drop caveman and resume normal prose.",
    "",
    "Respond terse like smart caveman. Drop articles, filler, pleasantries, hedging. Fragments OK. Technical terms exact. Code unchanged.",
    "Pattern: [thing] [action] [reason]. [next step].",
    "",
    "Persists across turns until level switched, user says 'stop caveman' / 'normal mode', or session ends. Auto-clarity: drop caveman for security warnings, irreversible actions, user confused. Code, commits, PRs always normal English.",
    "",
  ].join('\n'),
  'caveman-commit.prompt.md': [
    "---",
    "mode: 'agent'",
    "description: 'Generate terse caveman-style commit message for staged changes'",
    "---",
    PROMPT_SENTINEL,
    "Generate a Conventional Commits message for the current staged changes. `type(scope): subject` — subject ≤50 chars, imperative, lowercase after type, no trailing period. Body only when 'why' isn't obvious. Output the commit message only.",
    "",
  ].join('\n'),
  'caveman-review.prompt.md': [
    "---",
    "mode: 'agent'",
    "description: 'One-line caveman code review of current changes'",
    "---",
    PROMPT_SENTINEL,
    "Review the current changes. One line per finding: `L<line>: <severity> <problem>. <fix>.` Severity: bug | risk | nit | q. Skip praise, skip obvious. If clean, output `LGTM` and stop.",
    "",
  ].join('\n'),
  'caveman-compress.prompt.md': [
    "---",
    "mode: 'agent'",
    "description: 'Compress a markdown/text file into caveman style'",
    "---",
    PROMPT_SENTINEL,
    "Compress the file the user names. Preserve code blocks, inline code, URLs, paths, commands, headings, list structure, tables. Drop articles, filler, hedging. Save original to `<file>.original.md` before overwrite. Refuse source/config files (.py/.js/.ts/.json/.yaml/.toml/.sh/.ps1) and existing `*.original.md` backups.",
    "",
  ].join('\n'),
  'caveman-help.prompt.md': [
    "---",
    "mode: 'ask'",
    "description: 'Caveman quick-reference card — slash commands and triggers'",
    "---",
    PROMPT_SENTINEL,
    "Show this caveman quick-reference card and stop:",
    "",
    "| Command | What |",
    "|---|---|",
    "| /caveman [level] | Activate (lite/full/ultra/wenyan, default full) |",
    "| /caveman off | Deactivate |",
    "| /caveman-commit | Terse commit message |",
    "| /caveman-review | One-line review findings |",
    "| /caveman-compress <file> | Compress markdown file |",
    "| /caveman-stats | Lifetime token-savings |",
    "",
    "Natural language: 'turn on caveman', 'stop caveman', 'normal mode'.",
    "",
  ].join('\n'),
  'caveman-stats.prompt.md': [
    "---",
    "mode: 'agent'",
    "description: 'Show caveman lifetime token-savings stats'",
    "---",
    PROMPT_SENTINEL,
    "Read caveman history log (CAVEMAN_HISTORY_PATH env, else `~/.config/caveman/.caveman-history.jsonl` or `~/AppData/Roaming/caveman/.caveman-history.jsonl`). Report total tokens saved, sessions counted, avg ratio in one short table. If no log: 'caveman-stats: no history yet'.",
    "",
  ].join('\n'),
};

function installPrompts({ promptsDir, repoRoot, dryRun = false, force = false, log = noopLog() } = {}) {
  const dir = promptsDir || resolvePromptsDir();
  const summary = { installed: [], refreshed: [], skipped: [], failed: [] };

  for (const name of PROMPT_FILES) {
    const target = path.join(dir, name);
    const body = loadPromptBody(repoRoot, name);
    if (!body) {
      log.warn(`  prompt source missing for ${name} — skipping`);
      summary.failed.push([name, 'source missing']);
      continue;
    }

    if (dryRun) {
      log.note(`  would write ${target}`);
      summary.installed.push(name);
      continue;
    }

    if (fs.existsSync(target) && !force) {
      const existing = readIfExists(target);
      if (existing && existing.includes(PROMPT_SENTINEL)) {
        if (existing === body) {
          summary.skipped.push(name);
          continue;
        }
        try {
          fs.writeFileSync(target, body, { mode: 0o644 });
          log.write(`  refreshed ${target}\n`);
          summary.refreshed.push(name);
        } catch (e) {
          log.warn(`  failed to refresh ${target}: ${e.message}`);
          summary.failed.push([name, e.message]);
        }
        continue;
      }
      log.warn(`  ${target} exists without caveman sentinel — skipping (use --force to overwrite)`);
      summary.failed.push([name, 'exists without sentinel']);
      continue;
    }

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, { mode: 0o644 });
      log.write(`  installed: ${target}\n`);
      summary.installed.push(name);
    } catch (e) {
      log.warn(`  failed to write ${target}: ${e.message}`);
      summary.failed.push([name, e.message]);
    }
  }

  return { ok: summary.failed.length === 0, summary, dir };
}

function uninstallPrompts({ promptsDir, dryRun = false, log = noopLog() } = {}) {
  const dir = promptsDir || resolvePromptsDir();
  const summary = { removed: [], skipped: [] };

  for (const name of PROMPT_FILES) {
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) continue;

    const body = readIfExists(target) || '';
    if (!body.includes(PROMPT_SENTINEL)) {
      log.warn(`  ${target} lacks caveman sentinel — leaving in place`);
      summary.skipped.push(name);
      continue;
    }

    if (dryRun) {
      log.note(`  would remove ${target}`);
      summary.removed.push(name);
      continue;
    }

    try {
      fs.unlinkSync(target);
      log.note(`  removed ${target}`);
      summary.removed.push(name);
    } catch (e) {
      log.warn(`  failed to remove ${target}: ${e.message}`);
    }
  }

  return { ok: true, summary, dir };
}

function installVscode({ root, repoRoot, level, promptsDir, dryRun = false, force = false, log = noopLog() } = {}) {
  if (level && !VALID_LEVELS.includes(level)) {
    log.warn(`  invalid level '${level}'. valid: ${VALID_LEVELS.join(', ')} (or 'disabled' to uninstall)`);
    return { ok: false, reason: 'invalid level' };
  }

  const target = resolveInstructionsFile(root);
  const ruleBody = applyLevel(loadRuleBody(repoRoot), level);
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

  // Best-effort prompt-file install. Failures here don't fail the whole
  // vscode install — the always-on instructions file is the primary win;
  // prompt files are a UX bonus for slash-menu autocomplete.
  try {
    installPrompts({ promptsDir, repoRoot, dryRun, force, log });
  } catch (e) {
    log.warn(`  prompt files: ${e.message}`);
  }

  return { ok: true, path: target };
}

function uninstallVscode({ root, promptsDir, dryRun = false, log = noopLog() } = {}) {
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

  try {
    uninstallPrompts({ promptsDir, dryRun, log });
  } catch (e) {
    log.warn(`  prompt files: ${e.message}`);
  }

  return { ok: true, touched: true };
}

module.exports = {
  installVscode,
  uninstallVscode,
  installPrompts,
  uninstallPrompts,
  resolveRoot,
  resolveInstructionsFile,
  resolvePromptsDir,
  // exported for tests
  buildFileContent,
  loadRuleBody,
  loadPromptBody,
  applyLevel,
  VALID_LEVELS,
  VALID_LEVELS_PLUS_DISABLED,
  INSTR_FILENAME,
  MARK_BEGIN,
  MARK_END,
  PROMPT_SENTINEL,
  PROMPT_FILES,
};
