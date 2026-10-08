import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from '../utils/logger.js';
import type { SlashCommand } from '../types.js';

export interface LoadResult {
  commands: SlashCommand[];
  files: string[];
  skipped: string[];
}

function looksLikeCommand(value: unknown): value is SlashCommand {
  const candidate = value as Partial<SlashCommand> | undefined;
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof candidate.data === 'object' &&
    candidate.data !== null &&
    typeof (candidate.data as { toJSON?: unknown }).toJSON === 'function' &&
    typeof candidate.execute === 'function'
  );
}

async function walk(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (/\.(ts|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files.sort();
}

/**
 * Discovers command modules under `dir`.
 *
 * A file may default-export a command or an array of commands. Anything that
 * does not look like a command is recorded in `skipped` rather than silently
 * ignored, so a broken module is visible at startup.
 */
export async function loadCommands(dir: string, logger?: Logger): Promise<LoadResult> {
  const files = await walk(dir);
  const commands: SlashCommand[] = [];
  const skipped: string[] = [];
  const loaded: string[] = [];

  for (const file of files) {
    if (file.endsWith('loader.ts') || file.endsWith('loader.js')) continue;
    try {
      const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
      const candidates: unknown[] = [];
      if (Array.isArray(module.default)) candidates.push(...module.default);
      else if (module.default) candidates.push(module.default);
      for (const value of Object.values(module)) {
        if (value !== module.default) candidates.push(value);
      }

      let found = 0;
      for (const candidate of candidates) {
        if (looksLikeCommand(candidate)) {
          commands.push(candidate);
          found += 1;
        }
      }
      if (found > 0) {
        loaded.push(path.basename(file));
      } else {
        skipped.push(path.basename(file));
        logger?.warn(`No command exported by ${path.basename(file)}`);
      }
    } catch (error) {
      skipped.push(path.basename(file));
      logger?.error(`Failed to load command file ${path.basename(file)}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      // A broken module must not take the whole bot down.
    }
  }
  return { commands, files: loaded, skipped };
}
