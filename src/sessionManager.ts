import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { ActivityTracker } from "./activityTracker";
import { WindowManager } from "./windowManager";
import { ActivityRecord } from "./types";
import { resolveCwd } from "./cwdResolver";

const SESSIONS_DIR = path.join(os.homedir(), ".vscode-terminal-sessions");

export interface SessionTerminal {
  name: string;
  cwd: string;
}

export interface SessionWindow {
  folderPath: string;
  folderName: string;
  terminals: SessionTerminal[];
}

export interface Session {
  name: string;
  savedAt: string;
  windows: SessionWindow[];
}

export class SessionManager implements vscode.Disposable {
  constructor(
    private tracker: ActivityTracker,
    private windowManager: WindowManager
  ) {}

  /** Save current terminal workspace to a session file */
  async saveSession(): Promise<void> {
    const defaultName = new Date().toISOString().slice(0, 10);
    const name = await vscode.window.showInputBox({
      prompt: "Session name",
      value: defaultName,
      validateInput: (v) =>
        v.trim() ? null : "Name cannot be empty",
    });
    if (!name) return;

    const session = await this.buildSession(name.trim());
    this.ensureDir();
    const filePath = path.join(SESSIONS_DIR, `${session.name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));

    const totalTerminals = session.windows.reduce(
      (sum, w) => sum + w.terminals.length, 0
    );
    vscode.window.showInformationMessage(
      `Session "${session.name}" saved: ${session.windows.length} window(s), ${totalTerminals} terminal(s)`
    );
  }

  /** Restore a previously saved session */
  async restoreSession(): Promise<void> {
    const sessions = this.listSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage("No saved sessions found.");
      return;
    }

    const pick = await vscode.window.showQuickPick(
      sessions.map((s) => ({
        label: s.name,
        description: `${s.windows.length} window(s) — ${s.savedAt}`,
        session: s,
      })),
      { placeHolder: "Select a session to restore" }
    );
    if (!pick) return;

    await this.doRestore(pick.session);
  }

  /** List/delete saved sessions */
  async manageSessions(): Promise<void> {
    const sessions = this.listSessions();
    if (sessions.length === 0) {
      vscode.window.showInformationMessage("No saved sessions found.");
      return;
    }

    const picks = await vscode.window.showQuickPick(
      sessions.map((s) => ({
        label: s.name,
        description: `${s.windows.length} window(s) — ${s.savedAt}`,
        session: s,
      })),
      { placeHolder: "Select session(s) to delete", canPickMany: true }
    );
    if (!picks || picks.length === 0) return;

    for (const p of picks) {
      const filePath = path.join(SESSIONS_DIR, `${p.session.name}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    vscode.window.showInformationMessage(
      `Deleted ${picks.length} session(s).`
    );
  }

  /** Get saved sessions for TreeView display */
  listSessions(): Session[] {
    this.ensureDir();
    const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
    const sessions: Session[] = [];
    for (const f of files) {
      try {
        const data = fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8");
        sessions.push(JSON.parse(data));
      } catch {
        // skip corrupt files
      }
    }
    // Most recent first
    sessions.sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
    return sessions;
  }

  private async buildSession(name: string): Promise<Session> {
    const allTerminals = this.windowManager.getAllTerminals();

    // Group by window
    const windowMap = new Map<string, { windowName: string; terminals: ActivityRecord[] }>();
    for (const t of allTerminals) {
      let entry = windowMap.get(t.windowId);
      if (!entry) {
        entry = { windowName: t.windowName, terminals: [] };
        windowMap.set(t.windowId, entry);
      }
      entry.terminals.push(t);
    }

    const windows: SessionWindow[] = [];
    for (const [windowId, { windowName, terminals }] of windowMap) {
      const sessionTerminals: SessionTerminal[] = [];

      for (const t of terminals) {
        let cwd: string | undefined;

        // Resolve CWD only for local terminals (we have the pid)
        if (t.isLocal && t.processId) {
          cwd = resolveCwd(t.processId);
        }

        sessionTerminals.push({
          name: t.name,
          cwd: cwd ?? windowId, // fallback to workspace folder
        });
      }

      windows.push({
        folderPath: windowId,
        folderName: windowName,
        terminals: sessionTerminals,
      });
    }

    return {
      name,
      savedAt: new Date().toISOString(),
      windows,
    };
  }

  private async doRestore(session: Session): Promise<void> {
    const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let restoredCount = 0;

    for (const win of session.windows) {
      if (win.folderPath === currentFolder) {
        // Restore terminals in the current window
        for (const t of win.terminals) {
          vscode.window.createTerminal({ name: t.name, cwd: t.cwd });
          restoredCount++;
        }
      } else {
        // Write a restore request to globalState for other windows to pick up,
        // then open the folder in a new window
        const restoreKey = `restore:${win.folderPath}`;
        // Store the terminals to create
        await vscode.workspace
          .getConfiguration()
          .update(restoreKey, win.terminals, vscode.ConfigurationTarget.Global)
          .then(undefined, () => {
            // Configuration update may fail; use globalState instead
          });

        // Open folder in new window
        const folderUri = vscode.Uri.file(win.folderPath);
        if (fs.existsSync(win.folderPath)) {
          await vscode.commands.executeCommand(
            "vscode.openFolder",
            folderUri,
            { forceNewWindow: true }
          );
          restoredCount += win.terminals.length;
        }
      }
    }

    vscode.window.showInformationMessage(
      `Session "${session.name}" restored: ${restoredCount} terminal(s)`
    );
  }

  private ensureDir(): void {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  dispose(): void {
    // nothing to clean up
  }
}
