import * as vscode from "vscode";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { SessionManager } from "./sessionManager";
import { TerminalTreeDataProvider } from "./treeView";
import { isActiveToday } from "./utils";

export function registerCommands(
  context: vscode.ExtensionContext,
  tracker: ActivityTracker,
  windowManager: WindowManager,
  sessionManager: SessionManager,
  treeProvider: TerminalTreeDataProvider
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "ccTabManagement.focusTerminal",
      (recordId: string) => {
        const terminalMap = tracker.getTerminalMap();
        for (const [terminal, record] of terminalMap) {
          if (record.id === recordId) {
            terminal.show();
            return;
          }
        }
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.closeTerminal",
      (treeItem: unknown) => {
        // Called from context menu — treeItem is the TreeElement
        // But we also get the record id from the command property
        // Try to find terminal from all local terminals
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
      "ccTabManagement.renameTerminal",
      async (treeItem: unknown) => {
        const item = treeItem as { record?: { id: string; displayName?: string; name: string } };
        if (!item?.record?.id) return;

        const currentName = item.record.displayName ?? item.record.name;
        const newName = await vscode.window.showInputBox({
          prompt: "Rename terminal",
          value: currentName,
          validateInput: (v) => (v.trim() ? null : "Name cannot be empty"),
        });
        if (newName === undefined) return; // cancelled

        tracker.setDisplayName(item.record.id, newName.trim());
      }
    )
  );
}
