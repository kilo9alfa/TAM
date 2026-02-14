import * as vscode from "vscode";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { StatusBarManager } from "./statusBar";
import { TerminalTreeDataProvider } from "./treeView";
import { SessionManager } from "./sessionManager";
import { registerCommands } from "./commands";

export function activate(context: vscode.ExtensionContext) {
  console.log("CCTabManagement: activating");

  const tracker = new ActivityTracker(context);
  const windowManager = new WindowManager(context, tracker);
  const statusBar = new StatusBarManager(tracker);
  const sessionManager = new SessionManager(tracker, windowManager);

  const treeProvider = new TerminalTreeDataProvider(tracker, windowManager);
  const treeView = vscode.window.createTreeView(
    "ccTabManagement.terminalActivity",
    { treeDataProvider: treeProvider, showCollapseAll: true }
  );

  // Debounced refresh for the tree
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => treeProvider.refresh(), 300);
  };

  context.subscriptions.push(
    tracker,
    windowManager,
    statusBar,
    sessionManager,
    treeView,
    treeProvider,
    tracker.onDidChange(scheduleRefresh),
    windowManager.onDidChange(scheduleRefresh)
  );

  registerCommands(context, tracker, windowManager, sessionManager, treeProvider);
}

export function deactivate() {
  console.log("CCTabManagement: deactivating");
}
