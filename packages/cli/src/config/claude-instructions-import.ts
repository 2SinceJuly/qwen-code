/**
 * @license
 * Copyright 2025 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getGlobalQwenDirLite } from './storage-paths-lite.js';

export type ClaudeInstructionsScope = 'user' | 'project';

export interface ClaudeInstructionsImportOptions {
  scope: ClaudeInstructionsScope;
  cwd?: string;
  homeDir?: string;
  qwenDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ClaudeInstructionsImportResult {
  scope: ClaudeInstructionsScope;
  /** The Claude file that was read, or the first candidate when none exists. */
  sourcePath: string;
  targetPath: string;
  action: 'created' | 'appended' | 'already-imported' | 'no-source';
  /** Files checked for a source, in the order they were tried. */
  checkedPaths: string[];
}

const IMPORTED_SECTION_HEADER = '## Imported from Claude Code';
const CLAUDE_FILENAME = 'CLAUDE.md';
const QWEN_FILENAME = 'QWEN.md';

function readTextFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return undefined;
    }
    throw error;
  }
}

/** Drops a leading YAML frontmatter block; Claude docs often carry one. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  const closing = content.indexOf('\n---', 3);
  if (closing === -1) {
    return content;
  }
  const bodyStart = content.indexOf('\n', closing + 1);
  return bodyStart === -1 ? '' : content.slice(bodyStart + 1);
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function resolvePaths(options: ClaudeInstructionsImportOptions): {
  sourceCandidates: string[];
  targetPath: string;
} {
  if (options.scope === 'project') {
    const cwd = options.cwd ?? process.cwd();
    return {
      sourceCandidates: [
        path.join(cwd, CLAUDE_FILENAME),
        path.join(cwd, '.claude', CLAUDE_FILENAME),
      ],
      targetPath: path.join(cwd, QWEN_FILENAME),
    };
  }

  const homeDir = options.homeDir ?? os.homedir();
  return {
    sourceCandidates: [path.join(homeDir, '.claude', CLAUDE_FILENAME)],
    targetPath: path.join(
      options.qwenDir ?? getGlobalQwenDirLite(options.env),
      QWEN_FILENAME,
    ),
  };
}

export function importClaudeInstructions(
  options: ClaudeInstructionsImportOptions,
): ClaudeInstructionsImportResult {
  const { sourceCandidates, targetPath } = resolvePaths(options);
  const base = {
    scope: options.scope,
    targetPath,
    checkedPaths: sourceCandidates,
  };

  let sourcePath: string | undefined;
  let sourceBody: string | undefined;
  for (const candidate of sourceCandidates) {
    const raw = readTextFile(candidate);
    if (raw === undefined) {
      continue;
    }
    const body = stripFrontmatter(raw).trim();
    if (body) {
      sourcePath = candidate;
      sourceBody = body;
      break;
    }
  }

  if (sourcePath === undefined || sourceBody === undefined) {
    return {
      ...base,
      sourcePath: sourceCandidates[0],
      action: 'no-source',
    };
  }

  // The header keeps the imported block identifiable so a later run can tell
  // its own earlier output from hand-written instructions and stay idempotent.
  const section = `${IMPORTED_SECTION_HEADER}\n\n${sourceBody}\n`;
  const existing = readTextFile(targetPath);

  if (existing !== undefined) {
    const normalizedExisting = normalizeNewlines(existing);
    if (
      normalizedExisting.includes(IMPORTED_SECTION_HEADER) &&
      normalizedExisting.includes(normalizeNewlines(sourceBody))
    ) {
      return { ...base, sourcePath, action: 'already-imported' };
    }
    const next = `${normalizedExisting.trimEnd()}\n\n${section}`;
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, next, 'utf-8');
    return { ...base, sourcePath, action: 'appended' };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, section, 'utf-8');
  return { ...base, sourcePath, action: 'created' };
}
