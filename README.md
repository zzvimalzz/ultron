# Ultron

A small Windows launcher for Claude and ChatGPT desktop accounts, with a local usage dashboard.

- **Accounts:** one card per account with a pixel mascot, live running state, last opened time, and tokens and active time for the last 24 hours. Click a card or press `1`–`9` to open it; the arrow next to **Open** chooses how (desktop app, CLI, VS Code or browser) and remembers the choice.
- **Usage:** tokens, token mix, top model, active time, sessions, tokens over time, a Week / Month / Year activity heatmap, models, accounts and projects. Filter by account and by 24H, 7D, 30D, 90D or All.
- **Crew:** a live flowchart of you, the leader, every agent, their sessions and subagents, who is working, and who is messaging whom. **Connect agents** gives Claude Code and Codex the Ultron Hub (shared memory and messages) and the `kiss` and `repo-structure` skills; **Disconnect** removes them.
- **Settings:** name, theme, minimize after opening, shared memory folder.

Usage covers Claude Code and Codex sessions stored on this PC. Chat conversations aren't stored locally, so they aren't counted.

## Install

1. Open [Releases](../../releases/latest) and download `Ultron-Setup-<version>.exe`.
2. Run it. Ultron installs for your user only (no admin needed) and adds Desktop and Start Menu shortcuts.
3. If Windows shows "Windows protected your PC", choose **More info → Run anyway**. The installer isn't code-signed.

On first launch Ultron adds the Claude and ChatGPT desktop apps it finds. To add another account, choose **Add account**: pick the service, sign in to its desktop app and terminal, then give it a look. Every new account gets its own CLI folder under `~/.ultron/homes`, so several Claude and Codex accounts run side by side in the terminal and in VS Code. ChatGPT Desktop holds one account, so extra ChatGPT accounts open in the CLI.

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
| `src/main/` | App lifecycle, IPC, config, profile detection, "Open with" targets |
| `src/main/usage/` | Incremental transcript scanning, parsing, attribution and aggregation |
| `src/hub/` | Ultron Hub MCP server, the shared CLI table (`cli.js`) and the skills shipped to every agent |
| `src/renderer/` | Vanilla ES-module UI: `lib/` shared helpers, `pages/` one module per page |
| `test/` | `node:test` suites with synthetic fixtures |
| `tools/` | Icon generator, personal-details check, screenshot driver |

Config and the usage cache live in `%APPDATA%\Ultron`. The hub keeps its roster, messages and default memory folder in `.ultron` in your user folder.

### Ultron Hub

Connecting registers `ultron-hub` in `~/.claude.json` and `~/.codex/config.toml` (and in any account's own CLI folder) and copies the skills into each agent's `skills` folder. Agents start the server through Ultron's executable, so Node isn't required. Its tools:

| Tool | Does |
| --- | --- |
| `crew` | Lists the agents, the leader, what each is good at and who is working |
| `recall` / `remember` | Search and save Markdown notes in the shared memory folder |
| `send_message` / `check_inbox` | Message an agent by name, `leader` or `everyone`, and read replies |

Claude is set up for code and SVG, and ChatGPT for code, images and GIFs. The hub tells every agent to send work to whichever one fits.
