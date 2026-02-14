import { execSync } from "child_process";
import { ClaudeState } from "./types";
import {
  CPU_GENERATING_THRESHOLD,
  APPROVAL_TIMEOUT_MS,
  COMMAND_TIMEOUT_MS,
} from "./config";

interface ProcessInfo {
  pid: number;
  ppid: number;
  cpu: number;
  command: string;
}

// Track previous states for transition-based heuristics
const prevStates = new Map<number, { state: ClaudeState; since: number }>();

/**
 * Detect Claude Code state for all terminal PIDs in a single ps call.
 * Returns a map from terminal PID to ClaudeState.
 */
export function detectClaudeStates(
  terminalPids: number[]
): Map<number, ClaudeState> {
  const result = new Map<number, ClaudeState>();
  if (terminalPids.length === 0) return result;

  let processes: ProcessInfo[];
  try {
    processes = getAllProcesses();
  } catch {
    // ps failed — return "none" for all
    for (const pid of terminalPids) {
      result.set(pid, "none");
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
      result.set(termPid, "none");
      cleanupTracking(termPid);
      continue;
    }

    const now = Date.now();
    const prev = prevStates.get(termPid);
    let state: ClaudeState;

    if (claudeProc.cpu > CPU_GENERATING_THRESHOLD) {
      // High CPU = generating
      state = "generating";
      prevStates.set(termPid, { state, since: now });
    } else if (prev?.state === "generating") {
      // Was generating, CPU just dropped → likely waiting for approval
      state = "approval";
      prevStates.set(termPid, { state, since: now });
    } else if (prev?.state === "approval") {
      // Still in approval state — check timeout
      if (now - prev.since > APPROVAL_TIMEOUT_MS) {
        state = "idle";
        prevStates.set(termPid, { state, since: now });
      } else {
        state = "approval";
      }
    } else {
      // Claude running, low CPU, no recent generation
      state = "idle";
      if (!prev || prev.state !== "idle") {
        prevStates.set(termPid, { state, since: now });
      }
    }

    result.set(termPid, state);
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
  // Match common Claude Code process patterns
  // e.g., "node /path/to/claude" or "/path/to/claude-code" or "claude"
  const lower = command.toLowerCase();
  return (
    /\bclaude\b/.test(lower) &&
    !lower.includes("claudedetector") // don't match ourselves
  );
}

function getAllProcesses(): ProcessInfo[] {
  const output = execSync("ps -e -o pid=,ppid=,pcpu=,command=", {
    encoding: "utf-8",
    timeout: COMMAND_TIMEOUT_MS,
  });

  const processes: ProcessInfo[] = [];
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: PID PPID %CPU COMMAND...
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    if (match) {
      processes.push({
        pid: parseInt(match[1], 10),
        ppid: parseInt(match[2], 10),
        cpu: parseFloat(match[3]),
        command: match[4],
      });
    }
  }
  return processes;
}

function cleanupTracking(termPid: number): void {
  prevStates.delete(termPid);
}

/** Clean up all tracking state */
export function disposeClaudeDetector(): void {
  prevStates.clear();
}
