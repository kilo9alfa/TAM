import * as vscode from "vscode";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { StatusBarManager } from "./statusBar";
import { TerminalTreeDataProvider, TreeElement } from "./treeView";
import { SessionManager } from "./sessionManager";
import { registerCommands } from "./commands";
import { FOCUS_DEBOUNCE_MS, TREE_REFRESH_DEBOUNCE_MS } from "./config";

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

  // Debounced click-to-focus: delays focus so context menu actions can cancel it
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  const cancelPendingFocus = () => {
    if (focusTimer) {
      clearTimeout(focusTimer);
      focusTimer = undefined;
    }
  };
  // Expose cancel function for commands to call
  (globalThis as Record<string, unknown>).__tamCancelFocus = cancelPendingFocus;

  treeView.onDidChangeSelection((e) => {
    cancelPendingFocus();
    const selected = e.selection[0];
    if (selected?.kind === "terminal" && selected.record.isLocal) {
      focusTimer = setTimeout(() => {
        const terminalMap = tracker.getTerminalMap();
        for (const [terminal, record] of terminalMap) {
          if (record.id === selected.record.id) {
            terminal.show();
            return;
          }
        }
      }, FOCUS_DEBOUNCE_MS);
    }
  });

  // Debounced refresh for the tree
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => treeProvider.refresh(), TREE_REFRESH_DEBOUNCE_MS);
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
