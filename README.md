# Ultron

A small Windows launcher for Claude and ChatGPT desktop accounts, with a local usage dashboard.

- **Accounts:** one card per account with a pixel mascot, live running state, last opened time, and tokens and active time for the last 24 hours. Click a card or press `1`–`9` to open it; the arrow next to **Open** chooses how (desktop app, CLI, VS Code or browser) and remembers the choice.
- **Usage:** tokens, token mix, top model, active time, sessions, tokens over time, a Week / Month / Year activity heatmap, models, accounts and projects. Filter by account and by 24H, 7D, 30D, 90D or All.
- **Settings:** name, theme, minimize after opening.

Usage covers Claude Code and Codex sessions stored on this PC. Chat conversations aren't stored locally, so they aren't counted.

## Development

Requires Node.js 22 or later. Keep the checkout on a short path: Windows' 260-character limit breaks Electron otherwise.

```powershell
npm install
npm start              # run the app
npm test               # unit tests
npm run lint:personal  # fail on personal details in the repo
npm run icon           # regenerate build/ultron.ico and build/ultron.png (Python + Pillow)
npm run package        # build dist/Ultron-win32-x64
```

| Path | Contents |
| --- | --- |
| `src/main/` | App lifecycle, IPC, config, profile detection, "Open with" targets |
| `src/main/usage/` | Incremental transcript scanning, parsing, attribution and aggregation |
| `src/renderer/` | Vanilla ES-module UI: `lib/` shared helpers, `pages/` one module per page |
| `test/` | `node:test` suites with synthetic fixtures |
| `tools/` | Icon generator, personal-details check, screenshot driver |

Config and the usage cache live in `%APPDATA%\Ultron`.
