import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { SessionManager } from "./sessionManager";
import { TerminalTreeDataProvider } from "./treeView";
import { resolveCwd } from "./cwdResolver";
import { resolveMemoryMdPath, getClaudeRulesFiles } from "./treeView";
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
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.editProjectClaudeMd",
      async (treeItem: unknown) => {
        cancelPendingFocus();
        const item = treeItem as { record?: { id: string; cwd?: string; processId?: number; claudeInfo?: { cwd?: string } } };
        if (!item?.record?.id) return;

        // Resolve CWD: stored record.cwd > claudeInfo.cwd > live resolveCwd(pid)
        let cwd = item.record.cwd || item.record.claudeInfo?.cwd;
        if (!cwd && item.record.processId) {
          cwd = resolveCwd(item.record.processId);
        }
        if (!cwd) {
          vscode.window.showWarningMessage("Could not determine terminal working directory.");
          return;
        }

        // Look for CLAUDE.md in the directory (case-insensitive search)
        const candidates = ["CLAUDE.md", "claude.md", "Claude.md"];
        let found: string | undefined;
        for (const name of candidates) {
          const p = path.join(cwd, name);
          if (fs.existsSync(p)) {
            found = p;
            break;
          }
        }

        if (!found) {
          const create = await vscode.window.showInformationMessage(
            `No CLAUDE.md found in ${cwd}. Create one?`,
            "Create",
            "Cancel"
          );
          if (create !== "Create") return;
          found = path.join(cwd, "CLAUDE.md");
          fs.writeFileSync(found, `# ${path.basename(cwd)}\n\n`, "utf-8");
        }

        await vscode.window.showTextDocument(vscode.Uri.file(found), {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
          preserveFocus: false,
        });
      }
    ),

    // Alias: "Create CLAUDE.md" uses the same handler as "Edit CLAUDE.md"
    vscode.commands.registerCommand(
      "ccTabManagement.createProjectClaudeMd",
      (...args: unknown[]) => vscode.commands.executeCommand("ccTabManagement.editProjectClaudeMd", ...args)
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.openMemoryMd",
      async (treeItem: unknown) => {
        cancelPendingFocus();
        const item = treeItem as { record?: { id: string; cwd?: string; claudeInfo?: { cwd?: string }; processId?: number } };
        if (!item?.record?.id) return;

        let cwd = item.record.cwd || item.record.claudeInfo?.cwd;
        if (!cwd && item.record.processId) {
          cwd = resolveCwd(item.record.processId);
        }
        if (!cwd) {
          vscode.window.showWarningMessage("Could not determine terminal working directory.");
          return;
        }

        let memoryPath = resolveMemoryMdPath(cwd);
        if (!memoryPath) {
          // Create the memory directory and MEMORY.md
          const dirName = cwd.replace(/[^a-zA-Z0-9-]/g, "-");
          const memoryDir = path.join(os.homedir(), ".claude", "projects", dirName, "memory");
          fs.mkdirSync(memoryDir, { recursive: true });
          memoryPath = path.join(memoryDir, "MEMORY.md");
          fs.writeFileSync(memoryPath, "", "utf-8");
        }

        await vscode.window.showTextDocument(vscode.Uri.file(memoryPath), {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
          preserveFocus: false,
        });
      }
    ),

    // Alias: "Create MEMORY.md" uses the same handler
    vscode.commands.registerCommand(
      "ccTabManagement.createMemoryMd",
      (...args: unknown[]) => vscode.commands.executeCommand("ccTabManagement.openMemoryMd", ...args)
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.openClaudeRules",
      async (treeItem: unknown) => {
        cancelPendingFocus();
        const item = treeItem as { record?: { id: string; cwd?: string; claudeInfo?: { cwd?: string }; processId?: number } };
        if (!item?.record?.id) return;

        let cwd = item.record.cwd || item.record.claudeInfo?.cwd;
        if (!cwd && item.record.processId) {
          cwd = resolveCwd(item.record.processId);
        }
        if (!cwd) {
          vscode.window.showWarningMessage("Could not determine terminal working directory.");
          return;
        }

        const rulesDir = path.join(cwd, ".claude", "rules");
        if (!fs.existsSync(rulesDir)) {
          fs.mkdirSync(rulesDir, { recursive: true });
        }

        const files = getClaudeRulesFiles(cwd);

        if (files.length === 0) {
          const newFile = path.join(rulesDir, "rules.md");
          fs.writeFileSync(newFile, "", "utf-8");
          await vscode.window.showTextDocument(vscode.Uri.file(newFile), {
            viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false,
          });
        } else if (files.length === 1) {
          await vscode.window.showTextDocument(vscode.Uri.file(files[0]), {
            viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false,
          });
        } else {
          await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(rulesDir));
        }
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.openProjectRules",
      async () => {
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
          vscode.window.showWarningMessage("No workspace folder open.");
          return;
        }

        const rulesDir = path.join(folder.uri.fsPath, ".claude", "rules");
        if (!fs.existsSync(rulesDir)) {
          fs.mkdirSync(rulesDir, { recursive: true });
        }

        const files = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"));

        if (files.length === 0) {
          const newFile = path.join(rulesDir, "rules.md");
          fs.writeFileSync(newFile, "", "utf-8");
          await vscode.window.showTextDocument(vscode.Uri.file(newFile), {
            viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false,
          });
        } else if (files.length === 1) {
          await vscode.window.showTextDocument(
            vscode.Uri.file(path.join(rulesDir, files[0])),
            { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false }
          );
        } else {
          await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(rulesDir));
        }
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.openUserRules",
      async () => {
        const rulesDir = path.join(os.homedir(), ".claude", "rules");
        if (!fs.existsSync(rulesDir)) {
          fs.mkdirSync(rulesDir, { recursive: true });
        }

        const files = fs.readdirSync(rulesDir).filter((f) => f.endsWith(".md"));

        if (files.length === 0) {
          // Create an empty rules file and open it
          const newFile = path.join(rulesDir, "rules.md");
          fs.writeFileSync(newFile, "", "utf-8");
          await vscode.window.showTextDocument(vscode.Uri.file(newFile), {
            viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false,
          });
        } else if (files.length === 1) {
          await vscode.window.showTextDocument(
            vscode.Uri.file(path.join(rulesDir, files[0])),
            { viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false }
          );
        } else {
          await vscode.commands.executeCommand("revealInExplorer", vscode.Uri.file(rulesDir));
        }
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.openGlobalMemoryMd",
      async () => {
        const memoryDir = path.join(os.homedir(), ".claude", "memory");
        if (!fs.existsSync(memoryDir)) {
          fs.mkdirSync(memoryDir, { recursive: true });
        }
        const filePath = path.join(memoryDir, "MEMORY.md");
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, "", "utf-8");
        }
        await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
          viewColumn: vscode.ViewColumn.Beside, preview: false, preserveFocus: false,
        });
      }
    ),

    vscode.commands.registerCommand(
      "ccTabManagement.openClaudeMd",
      async () => {
        const filePath = path.join(os.homedir(), ".claude", "CLAUDE.md");
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, "# Global Claude Configuration\n\n", "utf-8");
        }
        await vscode.window.showTextDocument(vscode.Uri.file(filePath), {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
          preserveFocus: false,
        });
      }
    )
  );
}
