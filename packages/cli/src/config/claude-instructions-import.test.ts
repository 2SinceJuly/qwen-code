/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importClaudeInstructions } from './claude-instructions-import.js';

describe('claude instructions import', () => {
  let tmpDir: string;
  let homeDir: string;
  let projectDir: string;
  let qwenDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-instructions-'));
    homeDir = path.join(tmpDir, 'home');
    projectDir = path.join(tmpDir, 'project');
    qwenDir = path.join(homeDir, '.qwen');
    fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(filePath: string, content: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  it('creates QWEN.md from the global CLAUDE.md', () => {
    write(
      path.join(homeDir, '.claude', 'CLAUDE.md'),
      '# Rules\n\n- Be terse.\n',
    );

    const result = importClaudeInstructions({
      scope: 'user',
      homeDir,
      qwenDir,
    });

    expect(result.action).toBe('created');
    const written = fs.readFileSync(result.targetPath, 'utf-8');
    expect(written).toContain('## Imported from Claude Code');
    expect(written).toContain('- Be terse.');
  });

  it('appends to an existing QWEN.md without touching prior content', () => {
    write(path.join(homeDir, '.claude', 'CLAUDE.md'), 'Claude rule');
    write(path.join(qwenDir, 'QWEN.md'), '# My rules\n\nKeep me.\n');

    const result = importClaudeInstructions({
      scope: 'user',
      homeDir,
      qwenDir,
    });

    expect(result.action).toBe('appended');
    const written = fs.readFileSync(result.targetPath, 'utf-8');
    expect(written.startsWith('# My rules\n\nKeep me.')).toBe(true);
    expect(written).toContain('## Imported from Claude Code');
    expect(written).toContain('Claude rule');
  });

  it('is idempotent on repeat runs', () => {
    write(path.join(homeDir, '.claude', 'CLAUDE.md'), 'Claude rule');
    const options = { scope: 'user' as const, homeDir, qwenDir };

    importClaudeInstructions(options);
    const second = importClaudeInstructions(options);

    expect(second.action).toBe('already-imported');
    const written = fs.readFileSync(second.targetPath, 'utf-8');
    expect(written.split('## Imported from Claude Code')).toHaveLength(2);
  });

  it('drops a leading YAML frontmatter block', () => {
    write(
      path.join(homeDir, '.claude', 'CLAUDE.md'),
      '---\nname: rules\n---\n\nBody text\n',
    );

    const result = importClaudeInstructions({
      scope: 'user',
      homeDir,
      qwenDir,
    });

    const written = fs.readFileSync(result.targetPath, 'utf-8');
    expect(written).toContain('Body text');
    expect(written).not.toContain('name: rules');
  });

  it('reads the project CLAUDE.md and writes the project QWEN.md', () => {
    write(path.join(projectDir, 'CLAUDE.md'), 'Project rule');

    const result = importClaudeInstructions({
      scope: 'project',
      cwd: projectDir,
      homeDir,
      qwenDir,
    });

    expect(result.action).toBe('created');
    expect(result.targetPath).toBe(path.join(projectDir, 'QWEN.md'));
    expect(fs.readFileSync(result.targetPath, 'utf-8')).toContain(
      'Project rule',
    );
  });

  it('falls back to .claude/CLAUDE.md in the project directory', () => {
    write(path.join(projectDir, '.claude', 'CLAUDE.md'), 'Nested rule');

    const result = importClaudeInstructions({
      scope: 'project',
      cwd: projectDir,
      homeDir,
      qwenDir,
    });

    expect(result.sourcePath).toBe(
      path.join(projectDir, '.claude', 'CLAUDE.md'),
    );
    expect(fs.readFileSync(result.targetPath, 'utf-8')).toContain(
      'Nested rule',
    );
  });

  it('reports no-source when no CLAUDE.md exists', () => {
    const result = importClaudeInstructions({
      scope: 'user',
      homeDir,
      qwenDir,
    });

    expect(result.action).toBe('no-source');
    expect(result.checkedPaths).toEqual([
      path.join(homeDir, '.claude', 'CLAUDE.md'),
    ]);
    expect(fs.existsSync(result.targetPath)).toBe(false);
  });

  it('treats a whitespace-only CLAUDE.md as no source', () => {
    write(path.join(homeDir, '.claude', 'CLAUDE.md'), '   \n\n');

    const result = importClaudeInstructions({
      scope: 'user',
      homeDir,
      qwenDir,
    });

    expect(result.action).toBe('no-source');
  });
});
