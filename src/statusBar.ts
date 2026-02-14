import * as vscode from "vscode";
import { ActivityTracker } from "./activityTracker";
import { isActiveToday, formatRelativeTime } from "./utils";
import { COLOR_ACTIVE, COLOR_STATUS_BAR_STALE } from "./config";

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private tracker: ActivityTracker) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      -100 // low priority, stays to the right of most items
    );
    this.item.command = "ccTabManagement.showTerminalActivity";
    this.item.name = "Terminal Activity";

    this.disposables.push(
      this.item,
      tracker.onDidChange(() => this.update()),
      vscode.window.onDidChangeActiveTerminal(() => this.update())
    );

    this.update();
    this.item.show();
  }

  private update(): void {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      this.item.text = "$(terminal) No terminal";
      this.item.tooltip = "No active terminal";
      this.item.color = undefined;
      return;
    }

    const record = this.tracker.getRecord(terminal);
    if (!record) {
      this.item.text = "$(terminal) unknown";
      this.item.tooltip = "Terminal activity unknown";
      this.item.color = undefined;
      return;
    }

    if (isActiveToday(record)) {
      const time = formatRelativeTime(record.lastActivity);
      this.item.text = `$(terminal) ${time}`;
      this.item.tooltip = `${record.name} — active ${time}`;
      this.item.color = new vscode.ThemeColor(COLOR_ACTIVE);
    } else {
      const relative = formatRelativeTime(record.lastActivity);
      this.item.text = `$(terminal) ${relative}`;
      this.item.tooltip = `${record.name} — last active ${relative}`;
      this.item.color = new vscode.ThemeColor(COLOR_STATUS_BAR_STALE);
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
