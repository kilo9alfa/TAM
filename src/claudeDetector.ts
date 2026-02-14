import { execSync } from "child_process";
import { ClaudeState, ClaudeInfo } from "./types";
import {
  CPU_GENERATING_THRESHOLD,
  APPROVAL_TIMEOUT_MS,
  COMMAND_TIMEOUT_MS,
} from "./config";

interface ProcessInfo {
  pid: number;
  ppid: number;
  cpu: number;
  rss: number;
  etime: string;
  command: string;
}

export interface ClaudeDetectResult {
  state: ClaudeState;
  info?: ClaudeInfo;
}

// Track previous states for transition-based heuristics
const prevStates = new Map<number, { state: ClaudeState; since: number }>();

/**
 * Detect Claude Code state for all terminal PIDs in a single ps call.
 * Returns a map from terminal PID to { state, info }.
 */
export function detectClaudeStates(
  terminalPids: number[]
): Map<number, ClaudeDetectResult> {
  const result = new Map<number, ClaudeDetectResult>();
  if (terminalPids.length === 0) return result;

  let processes: ProcessInfo[];
  try {
    processes = getAllProcesses();
  } catch {
    // ps failed — return "none" for all
    for (const pid of terminalPids) {
      result.set(pid, { state: "none" });
    }
    return result;
  }

  // Build parent→children map
  const childrenOf = new Map<number, number[]>();
  const processMap = new Map<number, ProcessInfo>();
  for (const p of processes) {
    processMap.set(p.pid, p);
    let children = childrenOf.get(p.ppid);
    if (!children) {
      children = [];
      childrenOf.set(p.ppid, children);
    }
    children.push(p.pid);
  }

  for (const termPid of terminalPids) {
    const claudeProc = findClaudeDescendant(
      termPid,
      childrenOf,
      processMap
    );

    if (!claudeProc) {
      result.set(termPid, { state: "none" });
      cleanupTracking(termPid);
      continue;
    }

    const now = Date.now();
    const prev = prevStates.get(termPid);
    let state: ClaudeState;

    if (claudeProc.cpu > CPU_GENERATING_THRESHOLD) {
      state = "generating";
      prevStates.set(termPid, { state, since: now });
    } else if (prev?.state === "generating") {
      state = "approval";
      prevStates.set(termPid, { state, since: now });
    } else if (prev?.state === "approval") {
      if (now - prev.since > APPROVAL_TIMEOUT_MS) {
        state = "idle";
        prevStates.set(termPid, { state, since: now });
      } else {
        state = "approval";
      }
    } else {
      state = "idle";
      if (!prev || prev.state !== "idle") {
        prevStates.set(termPid, { state, since: now });
      }
    }

    // Build ClaudeInfo
    const { count: childProcessCount, mcpServers } = countDescendants(
      claudeProc.pid,
      childrenOf,
      processMap
    );
    const skipPermissions = claudeProc.command.includes("--dangerously-skip-permissions");
    const info: ClaudeInfo = {
      pid: claudeProc.pid,
      etime: claudeProc.etime,
      skipPermissions,
      cpu: claudeProc.cpu,
      rss: claudeProc.rss,
      mcpServers,
      childProcessCount,
    };

    result.set(termPid, { state, info });
  }

  return result;
}

function findClaudeDescendant(
  pid: number,
  childrenOf: Map<number, number[]>,
  processMap: Map<number, ProcessInfo>
): ProcessInfo | undefined {
  const children = childrenOf.get(pid);
  if (!children) return undefined;

  for (const childPid of children) {
    const proc = processMap.get(childPid);
    if (proc && isClaudeProcess(proc.command)) {
      return proc;
    }
    // Recurse (claude may be a grandchild)
    const found = findClaudeDescendant(childPid, childrenOf, processMap);
    if (found) return found;
  }
  return undefined;
}

function isClaudeProcess(command: string): boolean {
  // Only match the actual Claude Code binary, not paths containing .claude/
  // Real examples: "claude --dangerously-skip-permissions", "claude", "node /path/to/claude"
  // False positives to avoid: ".claude/shell-snapshots/...", ".claude/mcp-servers/...", "grep claude"
  const lower = command.toLowerCase();

  // Reject things that just reference .claude/ directories
  if (lower.includes(".claude/")) return false;
  // Reject grep/search processes that happen to mention "claude"
  if (/\b(grep|rg|ag|find|ls|cat|head|tail)\b/.test(lower)) return false;

  // Match: command starts with "claude" (the binary itself)
  // or ends with "/claude" followed by args
  return /(?:^|\/)claude(?:\s|$)/.test(lower);
}

function getAllProcesses(): ProcessInfo[] {
  const output = execSync("ps -e -o pid=,ppid=,pcpu=,rss=,etime=,command=", {
    encoding: "utf-8",
    timeout: COMMAND_TIMEOUT_MS,
  });

  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: PID PPID %CPU RSS ELAPSED COMMAND...
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (match) {
      processes.push({
        pid: parseInt(match[1], 10),
        ppid: parseInt(match[2], 10),
        cpu: parseFloat(match[3]),
        rss: parseInt(match[4], 10),
        etime: match[5],
        command: match[6],
      });
    }
  }
  return processes;
}

/**
 * Walk the process tree from a root PID, counting descendants
 * and extracting MCP server names from command strings.
 */
function countDescendants(
  rootPid: number,
  childrenOf: Map<number, number[]>,
  processMap: Map<number, ProcessInfo>
): { count: number; mcpServers: string[] } {
  let count = 0;
  const mcpServers: string[] = [];
  const mcpPattern = /\.claude\/mcp-servers\/([^/]+)\//;

  const walk = (pid: number) => {
    const children = childrenOf.get(pid);
    if (!children) return;
    for (const childPid of children) {
      count++;
      const proc = processMap.get(childPid);
      if (proc) {
        const mcpMatch = proc.command.match(mcpPattern);
        if (mcpMatch) {
          const name = mcpMatch[1];
          if (!mcpServers.includes(name)) {
            mcpServers.push(name);
          }
        }
      }
      walk(childPid);
    }
  };

  walk(rootPid);
  return { count, mcpServers };
}

function cleanupTracking(termPid: number): void {
  prevStates.delete(termPid);
}

/** Clean up all tracking state */
export function disposeClaudeDetector(): void {
  prevStates.clear();
}
