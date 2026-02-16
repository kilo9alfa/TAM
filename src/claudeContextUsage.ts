import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const MAX_CONTEXT_TOKENS = 200_000;
const TAIL_BYTES = 16_384;

interface CacheEntry {
  mtimeMs: number;
  percent: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Map a CWD (e.g. "/Users/david/code/TAM") to the Claude projects directory name.
 */
function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

/**
 * Get context window usage percentage for a Claude session working in the given CWD.
 * Returns undefined if no session file is found or usage can't be determined.
 */
export function getContextPercent(cwd: string): number | undefined {
  const dirName = cwdToProjectDir(cwd);
  const projectDir = path.join(PROJECTS_DIR, dirName);

  // Find the most recently modified .jsonl file
  let files: string[];
  try {
    files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return undefined;
  }

  if (files.length === 0) return undefined;

  let newestFile = "";
  let newestMtime = 0;
  for (const file of files) {
    try {
      const stat = fs.statSync(path.join(projectDir, file));
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newestFile = file;
      }
    } catch {
      // skip
    }
  }

  if (!newestFile) return undefined;

  const filePath = path.join(projectDir, newestFile);

  // Check cache
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === newestMtime) {
    return cached.percent;
  }

  // Read last chunk of the file to find the most recent usage entry
  const percent = parseUsageFromTail(filePath);
  if (percent !== undefined) {
    cache.set(filePath, { mtimeMs: newestMtime, percent });
  }

  return percent;
}

function parseUsageFromTail(filePath: string): number | undefined {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return undefined;
  }

  try {
    const stat = fs.fstatSync(fd);
    const size = stat.size;
    const readSize = Math.min(TAIL_BYTES, size);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, size - readSize);

    const chunk = buffer.toString("utf-8");
    // Split into lines and parse from the end to find last usage
    const lines = chunk.split("\n");

    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      // Quick check before parsing
      if (!line.includes('"usage"')) continue;

      try {
        const obj = JSON.parse(line);
        const usage = obj?.message?.usage;
        if (usage) {
          const input = (usage.input_tokens || 0)
            + (usage.cache_creation_input_tokens || 0)
            + (usage.cache_read_input_tokens || 0);
          const percent = Math.round((input / MAX_CONTEXT_TOKENS) * 100);
          return Math.min(percent, 100);
        }
      } catch {
        // malformed line, skip
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return undefined;
}

export function disposeContextUsageCache(): void {
  cache.clear();
}
