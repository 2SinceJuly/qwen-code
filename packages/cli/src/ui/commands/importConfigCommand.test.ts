/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { SettingScope } from '../../config/settings.js';
import {
  formatClaudeInstructionsImportResult,
  formatClaudeMcpImportResult,
  importConfigCommand,
  parseImportConfigArgs,
  resolveImportSourceForScope,
} from './importConfigCommand.js';
import { CommandKind } from './types.js';
import type { ClaudeMcpImportResult } from '../../config/claudeMcpImport.js';
import { importClaudeMcpServers } from '../../config/claudeMcpImport.js';
import { importClaudeInstructions } from '../../config/claude-instructions-import.js';

vi.mock('../../config/claudeMcpImport.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../config/claudeMcpImport.js')>();
  return {
    ...actual,
    importClaudeMcpServers: vi.fn(),
  };
});

vi.mock(
  '../../config/claude-instructions-import.js',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../config/claude-instructions-import.js')
      >();
    return {
      ...actual,
      importClaudeInstructions: vi.fn(),
    };
  },
);

describe('importConfigCommand', () => {
  it('is a built-in command available in all execution modes', () => {
    expect(importConfigCommand.name).toBe('import-config');
    expect(importConfigCommand.kind).toBe(CommandKind.BUILT_IN);
    expect(importConfigCommand.supportedModes).toEqual([
      'interactive',
      'non_interactive',
      'acp',
    ]);
  });

  it('parses default arguments', () => {
    expect(parseImportConfigArgs('')).toEqual({
      source: 'all',
      sourceExplicit: false,
      scope: 'user',
      instructions: false,
      help: false,
    });
  });

  it('parses source and scope arguments', () => {
    expect(parseImportConfigArgs('claude-code --scope project')).toEqual({
      source: 'claude-code',
      sourceExplicit: true,
      scope: 'project',
      instructions: false,
      help: false,
    });
    expect(parseImportConfigArgs('--from=desktop -s user')).toEqual({
      source: 'claude-desktop',
      sourceExplicit: true,
      scope: 'user',
      instructions: false,
      help: false,
    });
  });

  it('parses the --instructions flag with a scope', () => {
    expect(parseImportConfigArgs('--instructions --scope project')).toEqual({
      source: 'all',
      sourceExplicit: false,
      scope: 'project',
      instructions: true,
      help: false,
    });
  });

  it('reports invalid arguments', () => {
    const result = parseImportConfigArgs('claude-code --scope system');
    expect(result.error).toContain('--scope');
  });

  it('uses project Claude Code configs for default project-scope imports', () => {
    expect(resolveImportSourceForScope('all', 'project', false)).toBe(
      'claude-code',
    );
  });

  it('keeps an explicit all source when importing to project scope', () => {
    expect(resolveImportSourceForScope('all', 'project', true)).toBe('all');
  });

  it('rejects project imports before reading or writing config', async () => {
    const action = importConfigCommand.action;
    if (!action) throw new Error('Expected import-config action.');

    const result = await action(
      {
        executionPolicy: {
          allowSessionReset: false,
          allowWorkspaceSettingsWrite: false,
          persistModelSelection: false,
          blockedBuiltinCommandNames: [],
        },
        services: {
          settings: {} as never,
          config: { getTargetDir: vi.fn(() => '/managed/child') } as never,
          logger: null,
        },
      } as never,
      '--scope project',
    );

    expect(importClaudeMcpServers).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      messageType: 'error',
      content: expect.stringContaining('not available'),
    });
  });

  it('formats imported and skipped servers', () => {
    const message = formatClaudeMcpImportResult({
      scope: 'user',
      settingScope: SettingScope.User,
      scanned: [],
      imported: [
        { name: 'filesystem', source: 'Claude Code' },
        { name: 'github', source: 'Claude Desktop' },
      ],
      skipped: [
        {
          name: 'context7',
          source: 'Claude Code',
          reason: 'already-exists',
        },
      ],
      errors: [],
    } satisfies ClaudeMcpImportResult);

    expect(message.messageType).toBe('warning');
    expect(message.content).toContain('Imported 2 MCP server(s)');
    expect(message.content).toContain('filesystem, github');
    expect(message.content).toContain('Skipped existing server(s): context7');
  });

  it('lists checked paths when nothing was imported', () => {
    const message = formatClaudeMcpImportResult({
      scope: 'user',
      settingScope: SettingScope.User,
      scanned: [
        {
          source: 'claude-code',
          label: 'Claude Code',
          path: '/home/u/.claude.json',
          servers: {},
          errors: [],
          found: false,
        },
      ],
      imported: [],
      skipped: [],
      errors: [],
    } satisfies ClaudeMcpImportResult);

    expect(message.messageType).toBe('info');
    expect(message.content).toContain('No new Claude MCP servers imported');
    expect(message.content).toContain('/home/u/.claude.json');
  });

  it('keeps no-op imports with source warnings as warnings', () => {
    const message = formatClaudeMcpImportResult({
      scope: 'user',
      settingScope: SettingScope.User,
      scanned: [],
      imported: [],
      skipped: [
        {
          name: 'filesystem',
          source: 'Claude Code',
          reason: 'already-exists',
        },
      ],
      errors: [
        '/home/u/.claude.json: server "broken" is not an object - skipped',
      ],
    } satisfies ClaudeMcpImportResult);

    expect(message.messageType).toBe('warning');
    expect(message.content).toContain('No new Claude MCP servers imported');
    expect(message.content).toContain('Skipped existing server(s): filesystem');
    expect(message.content).toContain('Warnings:');
  });

  it('imports instructions when --instructions is passed', async () => {
    const action = importConfigCommand.action;
    if (!action) throw new Error('Expected import-config action.');

    vi.mocked(importClaudeInstructions).mockReturnValue({
      scope: 'project',
      sourcePath: '/tmp/project/CLAUDE.md',
      targetPath: '/tmp/project/QWEN.md',
      action: 'created',
      checkedPaths: ['/tmp/project/CLAUDE.md'],
    });

    const result = await action(
      {
        services: {
          settings: {} as never,
          config: { getTargetDir: vi.fn(() => '/tmp/project') } as never,
          logger: null,
        },
      } as never,
      '--instructions --scope project',
    );

    expect(importClaudeInstructions).toHaveBeenCalledWith({
      scope: 'project',
      cwd: '/tmp/project',
    });
    expect(importClaudeMcpServers).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      type: 'message',
      content: expect.stringContaining('/tmp/project/QWEN.md'),
    });
  });

  it('formats created, already-imported and no-source outcomes', () => {
    const created = formatClaudeInstructionsImportResult({
      scope: 'user',
      sourcePath: '/home/u/.claude/CLAUDE.md',
      targetPath: '/home/u/.qwen/QWEN.md',
      action: 'created',
      checkedPaths: ['/home/u/.claude/CLAUDE.md'],
    });
    expect(created.messageType).toBe('info');
    expect(created.content).toContain('/home/u/.qwen/QWEN.md');

    const already = formatClaudeInstructionsImportResult({
      scope: 'user',
      sourcePath: '/home/u/.claude/CLAUDE.md',
      targetPath: '/home/u/.qwen/QWEN.md',
      action: 'already-imported',
      checkedPaths: ['/home/u/.claude/CLAUDE.md'],
    });
    expect(already.content).toContain('already present');

    const missing = formatClaudeInstructionsImportResult({
      scope: 'project',
      sourcePath: '/p/CLAUDE.md',
      targetPath: '/p/QWEN.md',
      action: 'no-source',
      checkedPaths: ['/p/CLAUDE.md', '/p/.claude/CLAUDE.md'],
    });
    expect(missing.messageType).toBe('warning');
    expect(missing.content).toContain('/p/.claude/CLAUDE.md');
  });
});
