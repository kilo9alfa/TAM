import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const HISTORY_FILE = path.join(os.homedir(), ".claude", "history.jsonl");

let cachedMtime = 0;
let promptCache = new Map<string, string>();

/**
 * Get the last user prompt for a project path from Claude's history.
 * Caches the file and only re-reads when mtime changes.
 */
export function getLastPrompt(projectPath: string): string | undefined {
  refreshCacheIfNeeded();
  return promptCache.get(projectPath);
}

function refreshCacheIfNeeded(): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(HISTORY_FILE);
  } catch {
    return;
  }

  const mtime = stat.mtimeMs;
  if (mtime === cachedMtime) return;
  cachedMtime = mtime;

  const newCache = new Map<string, string>();
  try {
    const content = fs.readFileSync(HISTORY_FILE, "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        // Claude history entries have projectPath and message/prompt fields
        const projPath = entry.cwd || entry.projectPath || entry.directory;
        const prompt = entry.prompt || entry.message || entry.query;
        if (projPath && prompt && typeof prompt === "string") {
          newCache.set(projPath, prompt);
        }
      } catch {
        // skip malformed lines
      }
    }
  } catch {
    // file read failed
  }

  promptCache = newCache;
}

export function disposeHistoryCache(): void {
  cachedMtime = 0;
  promptCache.clear();
}
