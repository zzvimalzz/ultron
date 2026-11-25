import { ICONS } from './ui.js';

// Tool name -> what the agent is doing, for Claude Code and Codex tool names. The first match wins.
const KINDS = [
  ['memory', /ultron.hub/i, 'Using memory', 'book'],
  ['edit', /^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/, 'Editing', 'edit'],
  ['read', /^(Read|NotebookRead|view_image)$/, 'Reading', 'file'],
  ['search', /^(Grep|Glob|LS|ToolSearch)$/, 'Searching', 'search'],
  ['run', /^(Bash|PowerShell|Monitor|exec_command|write_stdin|shell|wait)$/, 'Running', 'terminal'],
  ['web', /web|browser|chrome|navigate/i, 'Browsing', 'globe'],
  ['agent', /^(Agent|Task|SendMessage)$/, 'Delegating', 'branch'],
  ['plan', /plan|todo/i, 'Planning', 'list'],
];
const HUB_VERBS = {
  context: 'Reading context', recall: 'Recalling', remember: 'Remembering', update: 'Updating memory', forget: 'Archiving a note',
  send_message: 'Messaging', check_inbox: 'Checking inbox', crew: 'Checking the crew',
};
const HUB_WRITES = ['remember', 'update', 'forget'];

const shortName = tool => tool.split('__').pop();
const slashes = text => text.replaceAll('/', '\\').toLowerCase();
const looksLikePath = text => /^[a-z]:[\\/]|^[\\/~]|^[\w.-]+[\\/][\w.\\/-]+$/i.test(text);
const baseName = p => p.split(/[\\/]/).filter(Boolean).pop() || p;

// act is [t, tool, detail] from the transcript scan; an empty tool is something the agent said.
export function describe([t, tool, detail], memoryDir = '') {
  if (!tool) return { t, kind: 'say', verb: '', target: detail, icon: ICONS.chat };
  const [kind, , verb, icon] = KINDS.find(([, test]) => test.test(tool)) || ['tool', null, `Using ${shortName(tool).replaceAll('_', ' ')}`, 'tool'];
  const target = looksLikePath(detail) ? baseName(detail) : detail;
  if (kind === 'memory') return { t, kind, verb: HUB_VERBS[shortName(tool)] || verb, target, icon: ICONS.book, writes: HUB_WRITES.includes(shortName(tool)) };
  if (memoryDir && slashes(detail).includes(slashes(memoryDir))) {
    return { t, kind: 'memory', verb: kind === 'edit' ? 'Writing memory' : 'Reading memory', target, icon: ICONS.book, writes: kind === 'edit' };
  }
  return { t, kind, verb, target, icon: ICONS[icon] };
}
