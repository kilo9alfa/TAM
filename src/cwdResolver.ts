import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";

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
    timeout: 3000,
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
