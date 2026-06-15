// Unit tests for the VS Code Copilot (user-scope) install helper.
// Covers: fresh install, idempotent re-install (no-op when bytes match),
// refresh when rule body changes, refusal to overwrite foreign files,
// uninstall removes only our file, uninstall skips files without markers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const HELPER = require(path.join(REPO_ROOT, 'bin', 'lib', 'vscode-copilot.js'));

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-vscode-'));
}

// Default installer args used across tests — isolates prompt-file writes
// to a tmp prompts dir so we never touch the real VS Code user prompts
// folder during test runs.
function args(root, extra = {}) {
  return { root, repoRoot: REPO_ROOT, promptsDir: path.join(root, 'prompts'), ...extra };
}

function targetPath(root) {
  return path.join(root, 'instructions', HELPER.INSTR_FILENAME);
}

test('installVscode writes a fresh file with caveman markers', () => {
  const root = makeTmp();
  try {
    const r = HELPER.installVscode(args(root));
    assert.equal(r.ok, true);
    const f = targetPath(root);
    assert.ok(fs.existsSync(f), 'instructions file should exist');
    const body = fs.readFileSync(f, 'utf8');
    assert.match(body, /^---\n/, 'frontmatter present');
    assert.ok(body.includes(HELPER.MARK_BEGIN), 'begin marker present');
    assert.ok(body.includes(HELPER.MARK_END), 'end marker present');
    assert.match(body, /Respond terse like smart caveman/);
    // applyTo: '**' makes the rule apply to every file context — required
    // for always-on behavior in VS Code Copilot.
    assert.match(body, /^applyTo: '\*\*'/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installVscode is idempotent — second run is a no-op when content matches', () => {
  const root = makeTmp();
  try {
    HELPER.installVscode(args(root));
    const r2 = HELPER.installVscode(args(root));
    assert.equal(r2.ok, true);
    assert.equal(r2.alreadyInstalled, true, 'should detect no-op refresh');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installVscode refreshes when existing file has our markers but different body', () => {
  const root = makeTmp();
  try {
    const f = targetPath(root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `---\nname: 'old'\n---\n${HELPER.MARK_BEGIN}\nstale body\n${HELPER.MARK_END}\n`);
    const r = HELPER.installVscode(args(root));
    assert.equal(r.ok, true);
    assert.equal(r.refreshed, true);
    const body = fs.readFileSync(f, 'utf8');
    assert.match(body, /Respond terse like smart caveman/);
    assert.doesNotMatch(body, /stale body/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installVscode refuses to overwrite a foreign file without --force', () => {
  const root = makeTmp();
  try {
    const f = targetPath(root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '---\nname: not ours\n---\nsomeone else owns this\n');
    const r = HELPER.installVscode(args(root));
    assert.equal(r.ok, false);
    const body = fs.readFileSync(f, 'utf8');
    assert.match(body, /someone else owns this/, 'foreign content untouched');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installVscode with --force overwrites foreign file', () => {
  const root = makeTmp();
  try {
    const f = targetPath(root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '---\nname: not ours\n---\nstomp me\n');
    const r = HELPER.installVscode(args(root, { force: true }));
    assert.equal(r.ok, true);
    const body = fs.readFileSync(f, 'utf8');
    assert.match(body, /Respond terse like smart caveman/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uninstallVscode removes our file', () => {
  const root = makeTmp();
  try {
    HELPER.installVscode(args(root));
    const r = HELPER.uninstallVscode({ root, promptsDir: path.join(root, 'prompts') });
    assert.equal(r.ok, true);
    assert.equal(r.touched, true);
    assert.equal(fs.existsSync(targetPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uninstallVscode leaves foreign files alone', () => {
  const root = makeTmp();
  try {
    const f = targetPath(root);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'no markers, not ours\n');
    const r = HELPER.uninstallVscode({ root, promptsDir: path.join(root, 'prompts') });
    assert.equal(r.ok, true);
    assert.equal(r.touched, false);
    assert.ok(fs.existsSync(f), 'foreign file preserved');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uninstallVscode is a no-op when target does not exist', () => {
  const root = makeTmp();
  try {
    const r = HELPER.uninstallVscode({ root, promptsDir: path.join(root, 'prompts') });
    assert.equal(r.ok, true);
    assert.equal(r.touched, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installer --list includes vscode row', () => {
  // Smoke test against the actual installer to make sure the PROVIDERS edit
  // didn't break the matrix render.
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('node', [path.join(REPO_ROOT, 'bin', 'install.js'), '--list'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /vscode\b/);
  assert.match(r.stdout, /VS Code Copilot \(user-scope\)/);
});

test('applyLevel rewrites Default intensity line', () => {
  const body = 'foo\nDefault intensity: full.\nbar\n';
  assert.equal(HELPER.applyLevel(body, 'lite'), 'foo\nDefault intensity: lite.\nbar\n');
  assert.equal(HELPER.applyLevel(body, 'ultra'), 'foo\nDefault intensity: ultra.\nbar\n');
  assert.equal(HELPER.applyLevel(body, 'wenyan-ultra'), 'foo\nDefault intensity: wenyan-ultra.\nbar\n');
});

test('applyLevel is a no-op for full or undefined', () => {
  const body = 'foo\nDefault intensity: full.\nbar\n';
  assert.equal(HELPER.applyLevel(body, 'full'), body);
  assert.equal(HELPER.applyLevel(body, undefined), body);
});

test('installVscode with --level lite writes lite as default', () => {
  const root = makeTmp();
  try {
    const r = HELPER.installVscode(args(root, { level: 'lite' }));
    assert.equal(r.ok, true);
    const body = fs.readFileSync(targetPath(root), 'utf8');
    assert.match(body, /Default intensity: lite\./);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installVscode rejects unknown level', () => {
  const root = makeTmp();
  try {
    const r = HELPER.installVscode(args(root, { level: 'bogus' }));
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(targetPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installVscode also drops slash-command prompt files', () => {
  const root = makeTmp();
  try {
    HELPER.installVscode(args(root));
    const promptsDir = path.join(root, 'prompts');
    for (const name of HELPER.PROMPT_FILES) {
      const p = path.join(promptsDir, name);
      assert.ok(fs.existsSync(p), `${name} should be installed`);
      const body = fs.readFileSync(p, 'utf8');
      assert.ok(body.includes(HELPER.PROMPT_SENTINEL), `${name} carries sentinel`);
      assert.match(body, /^---\r?\n/, `${name} has frontmatter`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uninstallVscode removes prompt files we installed', () => {
  const root = makeTmp();
  try {
    HELPER.installVscode(args(root));
    HELPER.uninstallVscode({ root, promptsDir: path.join(root, 'prompts') });
    for (const name of HELPER.PROMPT_FILES) {
      assert.equal(fs.existsSync(path.join(root, 'prompts', name)), false, `${name} should be removed`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('uninstallPrompts leaves user-authored prompt files alone', () => {
  const root = makeTmp();
  try {
    const promptsDir = path.join(root, 'prompts');
    fs.mkdirSync(promptsDir, { recursive: true });
    // A user-authored file at our managed name, but without our sentinel.
    const userPath = path.join(promptsDir, 'caveman.prompt.md');
    fs.writeFileSync(userPath, '---\ndescription: my custom caveman\n---\nmine, hands off\n');
    HELPER.uninstallPrompts({ promptsDir });
    assert.ok(fs.existsSync(userPath), 'user file untouched');
    assert.match(fs.readFileSync(userPath, 'utf8'), /mine, hands off/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installPrompts is idempotent — second run skips unchanged files', () => {
  const root = makeTmp();
  try {
    const promptsDir = path.join(root, 'prompts');
    HELPER.installPrompts({ promptsDir, repoRoot: REPO_ROOT });
    const r2 = HELPER.installPrompts({ promptsDir, repoRoot: REPO_ROOT });
    assert.equal(r2.ok, true);
    assert.equal(r2.summary.skipped.length, HELPER.PROMPT_FILES.length);
    assert.equal(r2.summary.installed.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolvePromptsDir matches platform conventions', () => {
  // Windows: %APPDATA%\Code\User\prompts
  const win = HELPER.resolvePromptsDir({ APPDATA: 'C:\\Roaming' }, 'win32');
  assert.match(win, /Code[\\\/]User[\\\/]prompts$/);
  // macOS: Library/Application Support
  const mac = HELPER.resolvePromptsDir({}, 'darwin');
  assert.match(mac, /Library[\\\/]Application Support[\\\/]Code[\\\/]User[\\\/]prompts$/);
  // Linux: $XDG_CONFIG_HOME/Code/User/prompts
  const lin = HELPER.resolvePromptsDir({ XDG_CONFIG_HOME: '/tmp/xdg' }, 'linux');
  assert.equal(lin, path.join('/tmp/xdg', 'Code', 'User', 'prompts'));
  // Override env var wins on every platform.
  const overridden = HELPER.resolvePromptsDir({ CAVEMAN_VSCODE_PROMPTS_DIR: '/custom/dir' }, 'linux');
  assert.equal(overridden, path.resolve('/custom/dir'));
});
