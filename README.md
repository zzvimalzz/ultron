# Ultron

A small Windows launcher for Claude and ChatGPT desktop accounts, with a local usage dashboard.

- **Accounts:** one card per account with a pixel mascot, live running state, last opened time, and tokens and active time for the last 24 hours. Click a card or press `1`–`9` to open it; the arrow next to **Open** chooses how (desktop app, CLI, VS Code or browser) and remembers the choice.
- **Plans:** each signed-in account shows its plan (Pro, Plus, Free…) as a badge, read from that account's own CLI without a model call and refreshed every six hours. If the plan can't be detected the badge asks you. Free accounts are left out of the crew.
- **Model and roles:** each account can pick a model and effort from its own CLI's live list, the kinds of work it does (code, UI/UX, QA, testing, research, review, images, SVG), whether it is in the crew and how many headless runs it carries. The terminal opens with the chosen model and effort; the hub's `crew` tool reports them to every agent.
- **Usage:** tokens, token mix, top model, active time, sessions, tokens over time, a Week / Month / Year activity heatmap, models, accounts and projects. Filter by account and by 24H, 7D, 30D, 90D or All.
- **Ultron:** give a task to the leader you chose. The leader works headlessly and, only when it needs to, builds teams with leads and members on your other paid accounts. Everyone runs behind a guard that only lets reversible actions through (no `git push`, no deletes outside the folder, no global installs); questions climb member → lead → leader → you and appear as an approval card and a Windows notification. A live chart shows the teams, delegations, reports, questions and memory use; the timeline logs every step. When a task finishes you see what changed and can **Undo all** (the folder is restored from a shadow Git checkpoint, so Git must be installed) or **Continue in terminal**. **Connect agents** gives Claude Code and Codex the Ultron Hub (shared memory and messages) and the `kiss` and `repo-structure` skills; **Disconnect** removes them.
- **Memory:** one vault of plain Markdown per device (`~/.ultron/memory` by default, or any folder you choose, including an existing vault). Agents read it at the start of a task and record outcomes, decisions and facts in separate places; facts about you wait under **To confirm** or in the **Inbox** until you review them on the Ultron page's Memory tab. **Keep memory tidy** lets a chosen account write sessions up after they end and review the vault weekly.
- **Settings:** name, theme, minimize after opening, memory folder and tidying.

Usage covers Claude Code and Codex sessions stored on this PC. Chat conversations aren't stored locally, so they aren't counted.

## Install

1. Open [Releases](../../releases/latest) and download `Ultron-Setup-<version>.exe`.
2. Run it. Ultron installs for your user only (no admin needed) and adds Desktop and Start Menu shortcuts.
3. If Windows shows "Windows protected your PC", choose **More info → Run anyway**. The installer isn't code-signed.

On first launch Ultron adds the Claude and ChatGPT desktop apps it finds. To add another account, choose **Add account**: pick the service, sign in to its desktop app and terminal, then give it a look. Every new account gets its own CLI folder under `~/.ultron/homes`, so several Claude and Codex accounts run side by side in the terminal and in VS Code. ChatGPT Desktop holds one account, so extra ChatGPT accounts open in the CLI.

**Gemini and Grok** are launch-only: they open in your browser and have no plan badge. They stay out of the crew because neither vendor's CLI can keep separate accounts apart or report a plan that Ultron can read.

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
| `src/hub/` | Ultron Hub MCP server, the shared CLI table (`cli.js`), the memory vault (`memory.js`, `vault/` skeleton), task records, checkpoint, guard and run processes, and the skills shipped to every agent |
| `src/renderer/` | Vanilla ES-module UI: `lib/` shared helpers, `pages/` one module per page |
| `test/` | `node:test` suites with synthetic fixtures |
| `tools/` | Icon generator, personal-details check, screenshot driver |

Config and the usage cache live in `%APPDATA%\Ultron`. The hub keeps its roster, messages and default memory folder in `.ultron` in your user folder.

### Ultron Hub

Connecting registers `ultron-hub` in `~/.claude.json` and `~/.codex/config.toml` (and in any account's own CLI folder) and copies the skills into each agent's `skills` folder. Agents start the server through Ultron's executable, so Node isn't required. Its tools:

| Tool | Does |
| --- | --- |
| `crew` | Lists the agents, the leader, what each is good at and who is working |
| `context` | The durable memory plus the current project's overview and state |
| `recall` / `remember` | Search the vault; save a note of a given kind (fact, profile, area, project-state, decision, session, inbox) |
| `update` / `forget` | Replace a stale note or archive it; the old version is always kept |
| `send_message` / `check_inbox` | Message an agent by name, `leader` or `everyone`, and read replies |

Inside a task started from Ultron the hub also offers `create_team`, `delegate`, `wait`, `answer`, `ask_up` and `runs`, depending on the agent's role. Sessions you start yourself get the memory and messaging tools only.

Claude is set up for code and SVG, and ChatGPT for code, images and GIFs. The hub tells every agent to send work to whichever one fits.
