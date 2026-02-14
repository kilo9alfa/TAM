import * as vscode from "vscode";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { ActivityRecord } from "./types";
import { isActiveToday, formatRelativeTime } from "./utils";
import {
  COLOR_ACTIVE,
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
} from "./config";

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

  get sortMode(): SortMode {
    return this._sortMode;
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

    if (r.isLocal) {
      item.contextValue = "terminal_local";
    } else {
      item.contextValue = "terminal_remote";
    }

    return item;
  }

  private buildDescription(r: ActivityRecord, relative: string): string {
    const claudeLabel = this.claudeStateLabel(r.claudeState);
    if (claudeLabel) {
      return `${claudeLabel} · ${relative}`;
    }
    return relative;
  }

  private buildIcon(r: ActivityRecord): vscode.ThemeIcon {
    switch (r.claudeState) {
      case "idle":
        return new vscode.ThemeIcon(ICON_TERMINAL, new vscode.ThemeColor(COLOR_CLAUDE_IDLE));
      case "generating":
        return new vscode.ThemeIcon(ICON_CLAUDE_GENERATING, new vscode.ThemeColor(COLOR_CLAUDE_GENERATING));
      case "approval":
        return new vscode.ThemeIcon(ICON_CLAUDE_APPROVAL, new vscode.ThemeColor(COLOR_CLAUDE_APPROVAL));
    }

    return new vscode.ThemeIcon(
      ICON_TERMINAL,
      isActiveToday(r)
        ? new vscode.ThemeColor(COLOR_ACTIVE)
        : new vscode.ThemeColor(COLOR_STALE)
    );
  }

  private buildTooltip(r: ActivityRecord, displayName: string, relative: string): string {
    const claudeLabel = this.claudeStateLabel(r.claudeState);
    const claudeSuffix = claudeLabel ? ` [Claude: ${claudeLabel}]` : "";
    if (r.isLocal) {
      return `${displayName} — ${relative}${claudeSuffix}${r.displayName ? ` (${r.name})` : ""}`;
    }
    return `${displayName} — ${relative}${claudeSuffix} (${r.windowName})`;
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
