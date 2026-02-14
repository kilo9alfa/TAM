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
  treeProvider.setExtensionPath(context.extensionPath);
  const treeView = vscode.window.createTreeView(
    "ccTabManagement.terminalActivity",
    { treeDataProvider: treeProvider, showCollapseAll: true }
  );

  // Debounced click-to-focus: delays focus so context menu actions can cancel it.
  // Tracks the target record ID so tree refreshes don't cancel a pending focus.
  let focusTimer: ReturnType<typeof setTimeout> | undefined;
  let focusTargetId: string | undefined;
  const cancelPendingFocus = () => {
    if (focusTimer) {
      clearTimeout(focusTimer);
      focusTimer = undefined;
      focusTargetId = undefined;
    }
  };
  // Expose cancel function for commands to call
  (globalThis as Record<string, unknown>).__tamCancelFocus = cancelPendingFocus;

  treeView.onDidChangeSelection((e) => {
    const selected = e.selection[0];
    const selectedId = selected?.kind === "terminal" ? selected.record.id : undefined;

    // If a focus is already pending for this same terminal, don't cancel it
    // (tree refreshes re-fire selection events for the same item)
    if (focusTimer && selectedId === focusTargetId) {
      return;
    }

    cancelPendingFocus();

    if (selected?.kind === "terminal" && selected.record.isLocal) {
      focusTargetId = selected.record.id;
      focusTimer = setTimeout(() => {
        focusTimer = undefined;
        focusTargetId = undefined;
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
