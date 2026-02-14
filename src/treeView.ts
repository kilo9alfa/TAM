import * as vscode from "vscode";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { ActivityRecord } from "./types";
import { isActiveToday, formatRelativeTime } from "./utils";

type TreeElement = GroupItem | TerminalItem;

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
        label: "Active Today",
        active: true,
        count: active.length,
        terminals: active,
      });
    }
    if (stale.length > 0) {
      groups.push({
        kind: "group",
        label: "Stale",
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
      group.active ? "circle-filled" : "circle-outline",
      group.active
        ? new vscode.ThemeColor("terminal.ansiGreen")
        : new vscode.ThemeColor("disabledForeground")
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
    item.description = relative;
    item.iconPath = new vscode.ThemeIcon(
      "terminal",
      isActiveToday(r)
        ? new vscode.ThemeColor("terminal.ansiGreen")
        : new vscode.ThemeColor("disabledForeground")
    );
    item.tooltip = r.isLocal
      ? `${displayName} — ${relative}${r.displayName ? ` (${r.name})` : ""}`
      : `${displayName} — ${relative} (${r.windowName})`;

    if (r.isLocal) {
      item.command = {
        command: "ccTabManagement.focusTerminal",
        title: "Focus Terminal",
        arguments: [r.id],
      };
      item.contextValue = "terminal_local";
    } else {
      item.contextValue = "terminal_remote";
    }

    return item;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
