import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { COMMAND_TIMEOUT_MS } from "./config";

/**
 * Resolve the current working directory for a process.
 * macOS: lsof -p <pid> -a -d cwd -Fn
 * Linux: readlink /proc/<pid>/cwd
 */
export function resolveCwd(pid: number): string | undefined {
  try {
    if (process.platform === "darwin") {
      return resolveCwdMacOS(pid);
    }
    if (process.platform === "linux") {
      return resolveCwdLinux(pid);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function resolveCwdMacOS(pid: number): string | undefined {
  // lsof output format with -Fn: lines starting with 'n' contain the name (path)
  const output = execSync(`lsof -p ${pid} -a -d cwd -Fn 2>/dev/null`, {
    encoding: "utf-8",
    timeout: COMMAND_TIMEOUT_MS,
  });
  for (const line of output.split("\n")) {
    if (line.startsWith("n") && line.length > 1) {
      const dir = line.slice(1);
      if (path.isAbsolute(dir)) return dir;
    }
  }
  return undefined;
}

function resolveCwdLinux(pid: number): string | undefined {
  const link = `/proc/${pid}/cwd`;
  if (!fs.existsSync(link)) return undefined;
  return fs.readlinkSync(link);
}

/**
 * Resolve CWDs for multiple PIDs in a single system call where possible.
 * macOS: single lsof call for all PIDs.
 * Linux: loop readlink /proc/<pid>/cwd.
 */
export function batchResolveCwds(pids: number[]): Map<number, string> {
  const result = new Map<number, string>();
  if (pids.length === 0) return result;

  try {
    if (process.platform === "darwin") {
      const pidList = pids.join(",");
      const output = execSync(`lsof -p ${pidList} -a -d cwd -Fn 2>/dev/null`, {
        encoding: "utf-8",
        timeout: COMMAND_TIMEOUT_MS,
      });
      let currentPid: number | undefined;
      for (const line of output.split("\n")) {
        if (line.startsWith("p") && line.length > 1) {
          currentPid = parseInt(line.slice(1), 10);
        } else if (line.startsWith("n") && line.length > 1 && currentPid !== undefined) {
          const dir = line.slice(1);
          if (path.isAbsolute(dir)) {
            result.set(currentPid, dir);
          }
        }
      }
    } else if (process.platform === "linux") {
      for (const pid of pids) {
        const link = `/proc/${pid}/cwd`;
        try {
          if (fs.existsSync(link)) {
            result.set(pid, fs.readlinkSync(link));
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // batch call failed, return what we have
  }

  return result;
}
