'use strict';
// Claude Code SessionStart hook: prints the vault's context for the session's folder. It never blocks a session.
const memory = require('./memory');
const { CREW_FILE, MEMORY_DIR, readJson } = require('./files');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const { cwd } = JSON.parse(input);
    const vault = readJson(CREW_FILE, {}).memoryDir || MEMORY_DIR;
    if (!memory.isVault(vault)) return;
    const additionalContext = memory.context(vault, cwd);
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }));
  } catch { /* stay silent */ }
});
