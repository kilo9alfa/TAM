# TAM - Todo List

## Claude Code Integration Ideas

### Easy (detectable now via PID/process inspection)

- Detect whether a terminal is running Claude Code (detect `claude` process)
- Show session duration (process start time)
- Show working directory of the Claude session

### Medium (parsing Claude Code's files/state)

- Read `~/.claude/projects/` for project-specific state
- Show active model (from config or status)
- Show CLAUDE.md project context (which project Claude is working on)
- Show todo list items if Claude is using TodoWrite

### Hard (requires parsing terminal output or proposed API)

- Status: whether Claude is thinking, generating, waiting for input, or waiting for tool approval
- Token usage / cost for the session
- Last tool used (Read, Edit, Bash, etc.)
- Files being modified in real-time
- Current task description from the conversation

### High Value Features

- Status indicator: green (generating), yellow (waiting for approval), gray (idle/waiting for input) — know at a glance which Claude sessions need attention
- Project name: since multiple projects run in parallel, show "TAM", "SaveMyBookmarks", etc. next to the terminal
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
- Write README.md

### Low Priority

- Package and publish to VS Code marketplace (or keep as local .vsix)
- Consider showing CWD path in tooltip
