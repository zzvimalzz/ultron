# Ultron

A small Windows launcher for Claude and ChatGPT desktop accounts, with a local usage dashboard.

- **Accounts:** one card per account with a pixel mascot, live running state, last opened time, and tokens and active time for the last 24 hours. Click a card or press `1`–`9` to open it; the arrow next to **Open** chooses how (desktop app, CLI, VS Code or browser) and remembers the choice.
- **Plans:** each signed-in account shows its plan (Pro, Plus, Free…) as a badge, read from that account's own CLI without a model call and refreshed every six hours. If the plan can't be detected the badge asks you. Free accounts can't run the memory curator.
- **Model:** each account can pick a model and effort from its own CLI's live list. The terminal opens with the chosen model and effort; the hub's `crew` tool reports them to every agent.
- **Usage:** tokens, token mix, top model, active time, sessions, tokens over time, a Week / Month / Year activity heatmap, models, accounts and projects. Filter by account and by 24H, 7D, 30D, 90D or All.
- **Ultron:** a full-window live map of every account at work. Each account is a node; its sessions hang off it, each session connects to the folder it works in, and every tool call spawns a node tinted by kind (edit, run, read, search, web, agent). Calls to the same MCP server, website or the memory vault meet at one shared node, and two sessions in the same folder share that folder's node. Drag a node, scroll to zoom, drag the background to pan, double-click it to fit everything again. Click an account to open it the way you chose; click a session to open it where it runs (Claude Desktop or Codex Desktop, VS Code in its folder, or a terminal resuming it; a terminal session that is still working already has its window, so Ultron says so instead of forking it); click a folder to open it. The **Live** panel lists each session's latest actions, and the full-screen button hides the sidebar and fills the screen (Esc leaves). **Connect agents** gives Claude Code and Codex the Ultron Hub (shared memory and messages) and the `kiss` and `repo-structure` skills; **Disconnect** removes them.
- **Memory:** one vault of plain Markdown per device (`~/.ultron/memory` by default, or any folder you choose, including an existing vault). Agents read it at the start of a task and record outcomes, decisions and facts in separate places; facts about you wait under **To confirm** or in the **Inbox** until you review them on the Ultron page's Memory tab. **Keep memory tidy** lets a chosen account write sessions up after they end and review the vault weekly.
- **Settings:** name, theme, minimize after opening, setup, memory folder and tidying, updates.

Usage covers Claude Code and Codex sessions stored on this PC. Chat conversations aren't stored locally, so they aren't counted.

## Install

1. Open [Releases](../../releases/latest) and download `Ultron-Setup-<version>.exe`. The installer isn't code-signed, so if Windows shows "Windows protected your PC", choose **More info → Run anyway**.
2. Run it. Ultron installs for your user only (no admin needed) and adds Desktop and Start Menu shortcuts.
3. Open Ultron and follow setup.

On first launch Ultron adds the Claude and ChatGPT desktop apps it finds. To add another account, choose **Add account**: pick the service, sign in to its desktop app and terminal, then give it a look. Every new account gets its own CLI folder under `~/.ultron/homes`, so several Claude and Codex accounts run side by side in the terminal and in VS Code. ChatGPT Desktop holds one account, so extra ChatGPT accounts open in the CLI.

**Gemini and Grok** are launch-only: they open in your browser and have no plan badge or place on the map, because neither vendor's CLI can keep separate accounts apart or report a plan that Ultron can read.

## For friends and family

Install, open Ultron, and follow setup. It has four steps, and every one can be skipped:

1. **Apps:** shows which of Claude Desktop, Claude Code, ChatGPT Desktop, Codex and Git are installed. A missing app has an **Install** link to its official page. Where a one-line install exists (`winget` or `npm`), the exact command is shown and **Run** opens it in a terminal after you click it. Nothing installs on its own.
2. **Accounts:** sign in to each account and add more.
3. **Memory:** create a new vault or choose an existing folder, and choose whether to connect your agents.
4. **Ready:** open Ultron. **Settings → Run setup again** brings it back.

Once a release is public, Ultron checks for updates every six hours and shows **Update ready · Restart** at the bottom of the sidebar. **Settings → Check for updates** checks now.

### What Ultron can't see

- Chat conversations. Only Claude Code and Codex sessions are stored on your PC, so only those are counted.
- Free plans' limits and usage. A free account can be launched and counted, but it can't run the memory curator.

## Release

Push a version tag and GitHub Actions builds the installer and publishes the release:

```powershell
git tag v1.2.0
git push origin v1.2.0
```

## Development

Requires Node.js 22 or later. Keep the checkout on a short path: Windows' 260-character limit breaks Electron otherwise.

```powershell
npm install
npm start              # run the app
npm test               # unit tests
npm run lint:personal  # fail on personal details in the repo
npm run icon           # regenerate build/ultron.ico and build/ultron.png (Python + Pillow)
npm run package        # build dist/Ultron-Setup-<version>.exe
```

| Path | Contents |
| --- | --- |
| `src/main/` | App lifecycle, IPC, config, profile detection, "Open with" targets, plan detection scheduler |
| `src/main/usage/` | Incremental transcript scanning, parsing, attribution and aggregation |
| `src/hub/` | Ultron Hub MCP server, the shared CLI table (`cli.js`), the memory vault (`memory.js`, `vault/` skeleton), and the skills shipped to every agent |
| `src/renderer/` | Vanilla ES-module UI: `lib/` shared helpers, `pages/` one module per page |
| `test/` | `node:test` suites with synthetic fixtures |
| `tools/` | Icon generator, personal-details check, screenshot driver |

Config and the usage cache live in `%APPDATA%\Ultron`. The hub keeps its account roster, messages and default memory folder in `.ultron` in your user folder.

### Ultron Hub

Connecting registers `ultron-hub` in `~/.claude.json` and `~/.codex/config.toml` (and in any account's own CLI folder) and copies the skills into each agent's `skills` folder. Agents start the server through Ultron's executable, so Node isn't required. Its tools:

| Tool | Does |
| --- | --- |
| `crew` | Lists the accounts with their plan and model, and who is working |
| `context` | The durable memory plus the current project's overview and state |
| `recall` / `remember` | Search the vault; save a note of a given kind (fact, profile, area, project-state, decision, session, inbox) |
| `update` / `forget` | Replace a stale note or archive it; the old version is always kept |
| `send_message` / `check_inbox` | Message an agent by name or `everyone`, and read replies |
