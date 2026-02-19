import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { ActivityRecord } from "./types";
import { isActiveToday, formatRelativeTime } from "./utils";
import { ClaudeInfo } from "./types";
import {
  COLOR_ACTIVE,
  COLOR_REMOTE,
  COLOR_STALE,
  COLOR_CLAUDE_IDLE,
  COLOR_CLAUDE_GENERATING,
  COLOR_CLAUDE_APPROVAL,
  ICON_TERMINAL,
  ICON_GROUP_ACTIVE,
  ICON_GROUP_STALE,
  ICON_CLAUDE_GENERATING,
  ICON_CLAUDE_APPROVAL,
  LABEL_GROUP_ACTIVE,
  LABEL_GROUP_STALE,
  LABEL_CLAUDE_IDLE,
  LABEL_CLAUDE_GENERATING,
  LABEL_CLAUDE_APPROVAL,
  TOOLTIP_PROMPT_MAX_LENGTH,
} from "./config";

const CTX_SCHEME = "tam-ctx";
const CTX_WARN_THRESHOLD = 60;

export type TreeElement = GroupItem | TerminalItem;

interface GroupItem {
  kind: "group";
  label: string;
  active: boolean;
  count: number;
  terminals: ActivityRecord[];
}

interface TerminalItem {
  kind: "terminal";
  record: ActivityRecord;
}

export type SortMode = "time" | "name";

export class TerminalTreeDataProvider
  implements vscode.TreeDataProvider<TreeElement>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _sortMode: SortMode = "time";
  private _extensionPath: string = "";

  get sortMode(): SortMode {
    return this._sortMode;
  }

  setExtensionPath(extensionPath: string): void {
    this._extensionPath = extensionPath;
  }

  constructor(
    private tracker: ActivityTracker,
    private windowManager: WindowManager
  ) {
    this.updateSortContext();
  }

  toggleSort(): void {
    this._sortMode = this._sortMode === "time" ? "name" : "time";
    this.updateSortContext();
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  private updateSortContext(): void {
    vscode.commands.executeCommand(
      "setContext",
      "ccTabManagement.sortMode",
      this._sortMode
    );
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element.kind === "group") {
      return this.buildGroupItem(element);
    }
    return this.buildTerminalItem(element);
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      return this.getRootGroups();
    }
    if (element.kind === "group") {
      return element.terminals.map((r) => ({ kind: "terminal", record: r }));
    }
    return [];
  }

  private getRootGroups(): GroupItem[] {
    const all = this.windowManager.getAllTerminals();
    const active: ActivityRecord[] = [];
    const stale: ActivityRecord[] = [];

    for (const t of all) {
      if (isActiveToday(t)) {
        active.push(t);
      } else {
        stale.push(t);
      }
    }

    const sort = (a: ActivityRecord, b: ActivityRecord) => {
      if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
      if (this._sortMode === "name") {
        const nameA = (a.displayName ?? a.name).toLowerCase();
        const nameB = (b.displayName ?? b.name).toLowerCase();
        return nameA.localeCompare(nameB);
      }
      return b.lastActivity - a.lastActivity;
    };
    active.sort(sort);
    stale.sort(sort);

    const groups: GroupItem[] = [];
    if (active.length > 0) {
      groups.push({
        kind: "group",
        label: LABEL_GROUP_ACTIVE,
        active: true,
        count: active.length,
        terminals: active,
      });
    }
    if (stale.length > 0) {
      groups.push({
        kind: "group",
        label: LABEL_GROUP_STALE,
        active: false,
        count: stale.length,
        terminals: stale,
      });
    }
    return groups;
  }

  private buildGroupItem(group: GroupItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${group.label}  ${group.count}`,
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.iconPath = new vscode.ThemeIcon(
      group.active ? ICON_GROUP_ACTIVE : ICON_GROUP_STALE,
      group.active
        ? new vscode.ThemeColor(COLOR_ACTIVE)
        : new vscode.ThemeColor(COLOR_STALE)
    );
    item.contextValue = group.active ? "group_active" : "group_stale";
    return item;
  }

  private buildTerminalItem(element: TerminalItem): vscode.TreeItem {
    const r = element.record;
    const displayName = r.displayName ?? r.name;
    const relative = formatRelativeTime(r.lastActivity);
    const windowSuffix = r.isLocal ? "" : `  [${r.windowName}]`;
    const label = `${displayName}${windowSuffix}`;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = this.buildDescription(r, relative);
    item.iconPath = this.buildIcon(r);
    item.tooltip = this.buildTooltip(r, displayName, relative);

    // Colorize high-context items via FileDecorationProvider
    const ctx = r.claudeInfo?.contextPercent;
    if (ctx !== undefined && ctx > CTX_WARN_THRESHOLD) {
      try {
        item.resourceUri = vscode.Uri.from({
          scheme: CTX_SCHEME,
          path: `/ctx-${ctx}`,
        });
      } catch {
        // ignore URI errors
      }
    }

    if (r.isLocal) {
      const cwd = r.cwd || r.claudeInfo?.cwd;
      const hasClaude = hasClaudeMd(cwd);
      const hasMemory = hasMemoryMd(cwd);
      const hasRules = hasClaudeRules(cwd);
      const hasCmds = hasClaudeCommands(cwd);
      const hasSettings = hasProjectSettings(cwd);
      const hasAgents = hasProjectAgents(cwd);
      let ctx = "terminal_local";
      if (hasClaude) ctx += "_claudemd";
      if (hasMemory) ctx += "_memorymd";
      if (hasRules) ctx += "_rules";
      if (hasCmds) ctx += "_commands";
      if (hasSettings) ctx += "_settings";
      if (hasAgents) ctx += "_agents";
      item.contextValue = ctx;
      // Command fires on every click, unlike onDidChangeSelection which skips re-clicks
      item.command = {
        command: "ccTabManagement.focusTerminal",
        title: "Focus Terminal",
        arguments: [r.id],
      };
    } else {
      item.contextValue = "terminal_remote";
    }

    return item;
  }

  private buildDescription(r: ActivityRecord, relative: string): string {
    const claudeLabel = this.claudeStateLabel(r.claudeState);
    const ctxSuffix = r.claudeInfo?.contextPercent !== undefined
      ? `; ctx = ${r.claudeInfo.contextPercent}%`
      : "";
    if (claudeLabel) {
      return `${claudeLabel} · ${relative}${ctxSuffix}`;
    }
    return `${relative}${ctxSuffix}`;
  }

  private buildIcon(r: ActivityRecord): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
    if (r.claudeState && r.claudeState !== "none" && this._extensionPath) {
      // Remote Claude terminals: use cyan-tinted ThemeIcons instead of custom SVGs
      if (!r.isLocal) {
        if (r.claudeState === "generating") {
          return new vscode.ThemeIcon(ICON_CLAUDE_GENERATING, new vscode.ThemeColor(COLOR_REMOTE));
        }
        const icon = r.claudeState === "approval" ? ICON_CLAUDE_APPROVAL : "terminal";
        return new vscode.ThemeIcon(icon, new vscode.ThemeColor(COLOR_REMOTE));
      }
      // Generating uses spinning ThemeIcon (custom SVGs can't animate)
      if (r.claudeState === "generating") {
        return new vscode.ThemeIcon(ICON_CLAUDE_GENERATING, new vscode.ThemeColor(COLOR_CLAUDE_GENERATING));
      }
      const iconFile = `claude-${r.claudeState}.svg`;
      const iconUri = vscode.Uri.file(path.join(this._extensionPath, "icons", iconFile));
      return { light: iconUri, dark: iconUri };
    }

    if (!r.isLocal) {
      return new vscode.ThemeIcon(
        ICON_TERMINAL,
        isActiveToday(r)
          ? new vscode.ThemeColor(COLOR_REMOTE)
          : new vscode.ThemeColor(COLOR_STALE)
      );
    }
    return new vscode.ThemeIcon(
      ICON_TERMINAL,
      isActiveToday(r)
        ? new vscode.ThemeColor(COLOR_ACTIVE)
        : new vscode.ThemeColor(COLOR_STALE)
    );
  }

  private buildTooltip(r: ActivityRecord, displayName: string, relative: string): string | vscode.MarkdownString {
    // Rich tooltip for Claude terminals
    if (r.claudeInfo && r.claudeState && r.claudeState !== "none") {
      return this.buildClaudeTooltip(r, displayName);
    }

    // Plain text for non-Claude terminals
    const claudeLabel = this.claudeStateLabel(r.claudeState);
    const claudeSuffix = claudeLabel ? ` [${claudeLabel}]` : "";
    if (r.isLocal) {
      return `${displayName} — ${relative}${claudeSuffix}${r.displayName ? ` (${r.name})` : ""}`;
    }
    return `${displayName} — ${relative}${claudeSuffix} (${r.windowName})`;
  }

  private buildClaudeTooltip(r: ActivityRecord, displayName: string): vscode.MarkdownString {
    const info = r.claudeInfo!;
    const stateLabel = this.claudeStateLabel(r.claudeState) ?? "unknown";
    const lines: string[] = [];

    // Header
    lines.push(`**${displayName}** — *${stateLabel}*`);
    lines.push("");

    // CWD
    if (info.cwd) {
      lines.push(`$(folder) ${info.cwd}`);
    }

    // Uptime
    if (info.etime) {
      lines.push(`$(clock) Uptime: ${formatEtime(info.etime)}`);
    }

    // Permissions mode
    if (info.skipPermissions) {
      lines.push(`$(unlock) Skip permissions`);
    } else {
      lines.push(`$(lock) Default`);
    }

    // CPU & Memory
    const memMB = (info.rss / 1024).toFixed(0);
    lines.push(`$(dashboard) CPU: ${info.cpu.toFixed(1)}% | Memory: ${memMB} MB`);

    // Subprocesses
    if (info.childProcessCount > 0) {
      lines.push(`$(list-tree) ${info.childProcessCount} subprocess${info.childProcessCount !== 1 ? "es" : ""}`);
    }

    // Context window usage
    if (info.contextPercent !== undefined) {
      lines.push(`$(symbol-ruler) Context: ${info.contextPercent}%`);
    }

    // MCP servers
    if (info.mcpServers.length > 0) {
      lines.push(`$(server) MCP: ${info.mcpServers.join(", ")}`);
    }

    // Last prompt
    if (info.lastPrompt) {
      lines.push("");
      lines.push("---");
      lines.push("");
      let prompt = info.lastPrompt;
      if (prompt.length > TOOLTIP_PROMPT_MAX_LENGTH) {
        prompt = prompt.slice(0, TOOLTIP_PROMPT_MAX_LENGTH) + "...";
      }
      lines.push(`*Last prompt:* "${prompt}"`);
    }

    const md = new vscode.MarkdownString(lines.join("\n\n"), true);
    md.supportThemeIcons = true;
    return md;
  }

  private claudeStateLabel(state: ActivityRecord["claudeState"]): string | undefined {
    switch (state) {
      case "idle": return LABEL_CLAUDE_IDLE;
      case "generating": return LABEL_CLAUDE_GENERATING;
      case "approval": return LABEL_CLAUDE_APPROVAL;
      default: return undefined;
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/** Check if CLAUDE.md exists in the given directory. */
function hasClaudeMd(cwd: string | undefined): boolean {
  if (!cwd) return false;
  for (const name of ["CLAUDE.md", "claude.md", "Claude.md"]) {
    if (fs.existsSync(path.join(cwd, name))) return true;
  }
  return false;
}

/** Check if MEMORY.md exists in the Claude projects memory directory for the given CWD. */
export function hasMemoryMd(cwd: string | undefined): boolean {
  if (!cwd) return false;
  const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, "-");
  const memoryPath = path.join(os.homedir(), ".claude", "projects", dirName, "memory", "MEMORY.md");
  return fs.existsSync(memoryPath);
}

/** Resolve the MEMORY.md path for a given CWD. Returns undefined if not found. */
export function resolveMemoryMdPath(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, "-");
  const memoryPath = path.join(os.homedir(), ".claude", "projects", dirName, "memory", "MEMORY.md");
  return fs.existsSync(memoryPath) ? memoryPath : undefined;
}

/** Check if .claude/rules/*.md files exist in the given CWD. */
export function hasClaudeRules(cwd: string | undefined): boolean {
  if (!cwd) return false;
  const rulesDir = path.join(cwd, ".claude", "rules");
  try {
    return fs.readdirSync(rulesDir).some((f) => f.endsWith(".md"));
  } catch {
    return false;
  }
}

/** Check if .claude/commands/*.md files exist in the given CWD. */
export function hasClaudeCommands(cwd: string | undefined): boolean {
  if (!cwd) return false;
  const commandsDir = path.join(cwd, ".claude", "commands");
  try {
    return fs.readdirSync(commandsDir).some((f) => f.endsWith(".md"));
  } catch {
    return false;
  }
}

/** Check if .claude/settings.json exists in the given CWD. */
export function hasProjectSettings(cwd: string | undefined): boolean {
  if (!cwd) return false;
  return fs.existsSync(path.join(cwd, ".claude", "settings.json"));
}

/** Check if .claude/agents/*.md files exist in the given CWD. */
export function hasProjectAgents(cwd: string | undefined): boolean {
  if (!cwd) return false;
  const agentsDir = path.join(cwd, ".claude", "agents");
  try {
    return fs.readdirSync(agentsDir).some((f) => f.endsWith(".md"));
  } catch {
    return false;
  }
}

/** Get all .md files in .claude/rules/ for the given CWD. */
export function getClaudeRulesFiles(cwd: string | undefined): string[] {
  if (!cwd) return [];
  const rulesDir = path.join(cwd, ".claude", "rules");
  try {
    return fs.readdirSync(rulesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(rulesDir, f));
  } catch {
    return [];
  }
}

/**
 * Format ps etime output (e.g. "2-19:12:34", "19:12:34", "12:34", "34") to human-readable.
 */
function formatEtime(etime: string): string {
  const trimmed = etime.trim();
  let days = 0;
  let rest = trimmed;

  // Handle DD- prefix
  const dashIdx = rest.indexOf("-");
  if (dashIdx !== -1) {
    days = parseInt(rest.slice(0, dashIdx), 10);
    rest = rest.slice(dashIdx + 1);
  }

  const parts = rest.split(":").map((s) => parseInt(s, 10));
  let hours = 0, minutes = 0;

  if (parts.length === 3) {
    hours = parts[0];
    minutes = parts[1];
  } else if (parts.length === 2) {
    hours = 0;
    minutes = parts[0];
  }

  const segments: string[] = [];
  if (days > 0) segments.push(`${days}d`);
  if (hours > 0 || days > 0) segments.push(`${hours}h`);
  segments.push(`${minutes}m`);

  return segments.join(" ");
}

/**
 * FileDecorationProvider that highlights tree items with high context usage (>60%) in red.
 */
export class ContextDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChange.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== CTX_SCHEME) return undefined;
    // Everything with our scheme is above threshold — decorate in red
    return {
      color: new vscode.ThemeColor("list.errorForeground"),
      badge: "!",
      tooltip: "Context window usage high",
    };
  }

  fireChange(): void {
    this._onDidChange.fire(undefined);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
