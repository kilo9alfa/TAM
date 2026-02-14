# TAM - Todo List

## Claude Code Integration Ideas

### Easy (detectable now via PID/process inspection)

- ~~Detect whether a terminal is running Claude Code (detect `claude` process)~~ DONE
- Show session duration (process start time)
- ~~Show working directory of the Claude session~~ DONE (auto-CWD naming)

### Medium (parsing Claude Code's files/state)

- Read `~/.claude/projects/` for project-specific state
- Show active model (from config or status)
- Show CLAUDE.md project context (which project Claude is working on)
- Show todo list items if Claude is using TodoWrite

### Hard (requires parsing terminal output or proposed API)

- Context window usage % — Claude Code only shows this in its status line; possible approaches: Claude Code hooks writing to a file, proposed `onDidWriteTerminalData` API, or future Claude Code API
- Token usage / cost for the session
- Last tool used (Read, Edit, Bash, etc.)
- Files being modified in real-time
- Current task description from the conversation

### High Value Features

- ~~Status indicator~~ DONE — idle (green Anthropic icon), generating (blue spinning), waiting (red Anthropic icon)
- ~~Project name~~ DONE (auto-CWD folder naming)
- Pending approval badge: notification dot when Claude is blocked waiting for tool approval

## Other Pending Items

### High Priority

- Test session save/restore end-to-end
- Test auto-CWD naming after reload
- Test terminal rename persistence across reloads

### Medium Priority

- Test cross-window terminal display
- Test "Close All Stale Terminals" command
- Add extension icon
- ~~Write README.md~~ DONE

### Low Priority

- Package and publish to VS Code marketplace (or keep as local .vsix)
- Consider showing CWD path in tooltip
