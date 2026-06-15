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

function targetPath(root) {
  return path.join(root, 'instructions', HELPER.INSTR_FILENAME);
}

test('installVscode writes a fresh file with caveman markers', () => {
  const root = makeTmp();
  try {
    const r = HELPER.installVscode({ root, repoRoot: REPO_ROOT });
    assert.equal(r.ok, true);
    const f = targetPath(root);
    assert.ok(fs.existsSync(f), 'instructions file should exist');
    const body = fs.readFileSync(f, 'utf8');
    assert.match(body, /^---\n/, 'frontmatter present');
    assert.ok(body.includes(HELPER.MARK_BEGIN), 'begin marker present');
    assert.ok(body.includes(HELPER.MARK_END), 'end marker present');
    assert.match(body, /Respond terse like smart caveman/);
    // No applyTo key — must stay always-on.
    assert.doesNotMatch(body, /^applyTo:/m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installVscode is idempotent — second run is a no-op when content matches', () => {
  const root = makeTmp();
  try {
    HELPER.installVscode({ root, repoRoot: REPO_ROOT });
    const r2 = HELPER.installVscode({ root, repoRoot: REPO_ROOT });
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
    const r = HELPER.installVscode({ root, repoRoot: REPO_ROOT });
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
    const r = HELPER.installVscode({ root, repoRoot: REPO_ROOT });
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
    const r = HELPER.installVscode({ root, repoRoot: REPO_ROOT, force: true });
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
    HELPER.installVscode({ root, repoRoot: REPO_ROOT });
    const r = HELPER.uninstallVscode({ root });
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
    const r = HELPER.uninstallVscode({ root });
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
    const r = HELPER.uninstallVscode({ root });
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
