import * as vscode from "vscode";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { SessionManager } from "./sessionManager";
import { TerminalTreeDataProvider } from "./treeView";
import { isActiveToday, formatRelativeTime } from "./utils";

function cancelPendingFocus(): void {
  const cancel = (globalThis as Record<string, unknown>).__tamCancelFocus;
  if (typeof cancel === "function") cancel();
}

export function registerCommands(
  context: vscode.ExtensionContext,
  tracker: ActivityTracker,
  windowManager: WindowManager,
  sessionManager: SessionManager,
  treeProvider: TerminalTreeDataProvider
): void {
  context.subscriptions.push(
    // focusTerminal is registered in extension.ts (with debounce + TreeItem.command support)

    vscode.commands.registerCommand(
      "ccTabManagement.closeTerminal",
      (treeItem: unknown) => {
        cancelPendingFocus();
        const terminalMap = tracker.getTerminalMap();

        // Context menu passes the TreeElement; extract the record id
        const item = treeItem as { record?: { id: string } };
        if (item?.record?.id) {
          for (const [terminal, record] of terminalMap) {
            if (record.id === item.record.id) {
              terminal.dispose();
              return;
            }
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.closeStaleTerminals",
      async () => {
        const terminalMap = tracker.getTerminalMap();
        const stale: vscode.Terminal[] = [];
        for (const [terminal, record] of terminalMap) {
          if (!isActiveToday(record)) {
            stale.push(terminal);
          }
        }

        if (stale.length === 0) {
          vscode.window.showInformationMessage("No stale terminals to close.");
          return;
        }

        const answer = await vscode.window.showWarningMessage(
          `Close ${stale.length} stale terminal(s)?`,
          { modal: true },
          "Close"
        );
        if (answer !== "Close") return;

        for (const t of stale) {
          t.dispose();
        }
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.showTerminalActivity",
      () => {
        vscode.commands.executeCommand(
          "ccTabManagement.terminalActivity.focus"
        );
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.refreshActivity",
      () => {
        treeProvider.refresh();
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.saveSession",
      () => sessionManager.saveSession()
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.restoreSession",
      () => sessionManager.restoreSession()
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.manageSessions",
      () => sessionManager.manageSessions()
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.toggleSort",
      () => treeProvider.toggleSort()
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.toggleSortBack",
      () => treeProvider.toggleSort()
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.searchTerminal",
      async () => {
        const terminalMap = tracker.getTerminalMap();
        if (terminalMap.size === 0) {
          vscode.window.showInformationMessage("No terminals open.");
          return;
        }

        const items: (vscode.QuickPickItem & { recordId: string })[] = [];
        for (const [_terminal, record] of terminalMap) {
          const label = record.displayName ?? record.name;
          const time = formatRelativeTime(record.lastActivity);
          const status = isActiveToday(record) ? "Active" : "Stale";
          items.push({
            label,
            description: `${status} · ${time}`,
            detail: record.name !== label ? record.name : undefined,
            recordId: record.id,
          });
        }

        // Sort alphabetically by label
        items.sort((a, b) => a.label.localeCompare(b.label));

        const pick = await vscode.window.showQuickPick(items, {
          placeHolder: "Search terminals...",
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (pick) {
          // Look up terminal by record ID (same pattern as focusTerminal)
          for (const [terminal, record] of terminalMap) {
            if (record.id === pick.recordId) {
              terminal.show();
              return;
            }
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.renameTerminal",
      async (treeItem: unknown) => {
        cancelPendingFocus();
        const item = treeItem as { record?: { id: string; displayName?: string; name: string } };

        let recordId: string | undefined;
        let currentName: string | undefined;

        if (item?.record?.id) {
          // Called from context menu
          recordId = item.record.id;
          currentName = item.record.displayName ?? item.record.name;
        } else {
          // Called via keybinding — use the active terminal
          const active = vscode.window.activeTerminal;
          if (!active) return;
          const record = tracker.getRecord(active);
          if (!record) return;
          recordId = record.id;
          currentName = record.displayName ?? record.name;
        }

        const newName = await vscode.window.showInputBox({
          prompt: "Rename terminal",
          value: currentName,
          validateInput: (v) => (v.trim() ? null : "Name cannot be empty"),
        });
        if (newName === undefined) return; // cancelled

        tracker.setDisplayName(recordId, newName.trim());
      }
    )
  );
}
