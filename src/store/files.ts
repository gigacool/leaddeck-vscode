import { mkdir, readFile, rename, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { EntityFile } from "../model/types.ts";

/**
 * Disk I/O. Atomic writes, per file (AD-10).
 *
 * There is no event log, so the JSON is the only copy. Write temp + rename,
 * never in place.
 */

export const filePath = (root: string, file: EntityFile): string =>
  join(root, `${file}.json`);

export async function readEntityFile(
  root: string,
  file: EntityFile,
): Promise<{ raw: unknown; mtimeMs: number } | null> {
  const p = filePath(root, file);
  let text: string;
  try {
    text = await readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const { mtimeMs } = await stat(p);
  try {
    return { raw: JSON.parse(text), mtimeMs };
  } catch (e) {
    // Never repaired, never rewritten (AD-10). The app has no repair path.
    throw new Error(
      `${file}.json is not valid JSON — ${(e as Error).message}\n  at ${p}`,
    );
  }
}

let tmpCounter = 0;

/** Returns the completion mtime, which the watcher's echo suppression keys on (AD-8). */
export async function writeEntityFile(
  root: string,
  file: EntityFile,
  rows: unknown[],
): Promise<number> {
  const p = filePath(root, file);
  const tmp = `${p}.tmp-${process.pid}-${tmpCounter++}`;
  await writeFile(tmp, JSON.stringify(rows, null, 2) + "\n", "utf8");
  await rename(tmp, p);
  const { mtimeMs } = await stat(p);
  return mtimeMs;
}

export async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

/**
 * Written once, so `git init` finds a sane repo. Running git is his, not ours —
 * he owns the folder.
 */
export async function ensureGitignore(root: string): Promise<void> {
  const p = join(root, ".gitignore");
  try {
    await stat(p);
  } catch {
    await writeFile(p, "*.tmp-*\n", "utf8");
  }
}
