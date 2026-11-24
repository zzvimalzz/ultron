'use strict';
// The hub tools a task run uses to build teams, hand out work and pass questions up. server.js lists
// them only when ULTRON_RUN is set, and only for the roles named here.
const { CREW_FILE, readJson } = require('./files');
const { ROLES } = require('./roles');
const { object, text } = require('./schema');
const tasks = require('./tasks');

const ME = { task: process.env.ULTRON_TASK, agent: process.env.ULTRON_AGENT, role: process.env.ULTRON_ROLE };
const MAX_WAIT_S = 50; // Codex gives MCP tools 60 s by default
const DEFAULT_WAIT_S = 45;
const POLL_MS = 1000;
const RESULT_CHARS = 8000;
const KINDS = ROLES.map(r => r.id);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const crewAgents = () => readJson(CREW_FILE, { agents: [] }).agents;
const agents = () => tasks.agentsOf(ME.task);
const me = () => agents().find(a => a.id === ME.agent);
const json = value => JSON.stringify(value, null, 2);

// The preferred account if it can take work, otherwise the best fit for the kind: most spare capacity,
// then fewest agents already in this task, then the least used in the last 24 hours.
function pickAccount(accounts, kind, preferred, counts = {}, assigned = {}) {
  const spare = a => (a.maxRuns || 1) - (counts[a.id] || 0);
  const usable = accounts.filter(a => a.eligible && spare(a) > 0);
  const named = preferred && usable.find(a => a.id === preferred || a.name.toLowerCase() === String(preferred).toLowerCase());
  return named || usable.filter(a => a.roles.includes(kind))
    .sort((a, b) => spare(b) - spare(a) || (assigned[a.id] || 0) - (assigned[b.id] || 0) || (a.tokens24h || 0) - (b.tokens24h || 0))[0] || null;
}

function assign(spec, assigned) {
  if (!KINDS.includes(spec.kind)) throw new Error(`Unknown kind "${spec.kind}". Kinds: ${KINDS.join(', ')}.`);
  const account = pickAccount(crewAgents(), spec.kind, spec.account, tasks.runningRunsByAccount(), assigned);
  if (!account) throw new Error(`No eligible account for ${spec.kind}. ask_up if this blocks you.`);
  assigned[account.id] = (assigned[account.id] || 0) + 1;
  return account;
}

const assignedCounts = () => agents().reduce((counts, a) => ({ ...counts, [a.account]: (counts[a.account] || 0) + 1 }), {});
const accountName = id => crewAgents().find(a => a.id === id)?.name || id;
const describe = a => `${a.id}: ${a.title} (${accountName(a.account)})`;

function createTeam({ name, purpose, lead, members = [] }) {
  const assigned = assignedCounts();
  const picks = [lead, ...members].map(spec => ({ spec, account: assign(spec, assigned) }));
  const team = tasks.addTeam(ME.task, { name, purpose, lead: null });
  const [leadAgent, ...memberAgents] = picks.map(({ spec, account }, i) => tasks.addAgent(ME.task, {
    title: spec.title, kind: spec.kind, account: account.id, team: team.id, role: i === 0 ? 'lead' : 'member', parent: i === 0 ? ME.agent : null,
  }));
  for (const member of memberAgents) tasks.updateAgent(ME.task, member.id, { parent: leadAgent.id });
  tasks.updateTeam(ME.task, team.id, { lead: leadAgent.id, members: memberAgents.map(a => a.id) });
  tasks.logEvent(ME.task, { type: 'team.created', agent: ME.agent, team: team.id, name });
  return `Team ${team.id} "${name}" created.\nLead: ${describe(leadAgent)}\nMembers:\n${memberAgents.map(a => `  ${describe(a)}`).join('\n') || '  none'}`;
}

function targetOf(to) {
  if (typeof to === 'object') {
    if (ME.role !== 'leader') throw new Error('Only the leader can delegate to a new solo agent.');
    const account = assign(to, assignedCounts());
    return tasks.addAgent(ME.task, { title: to.title, kind: to.kind, account: account.id, role: 'member', parent: ME.agent });
  }
  const target = agents().find(a => a.id === to);
  if (!target || target.parent !== ME.agent) throw new Error(`You can only delegate to your own direct reports. Yours: ${agents().filter(a => a.parent === ME.agent).map(describe).join('; ') || 'none'}.`);
  return target;
}

function delegate({ to, task, files }) {
  const target = targetOf(to);
  if (tasks.runsOf(ME.task).some(r => r.agent === target.id && tasks.isLive(r))) throw new Error(`${target.title} is still working. Use wait.`);
  const prompt = files?.length ? `${task}\n\nFiles you own: ${files.join(', ')}` : task;
  const run = tasks.startRun(ME.task, target.id, prompt);
  return json({ runId: run.id, agent: target.id });
}

const reportOf = run => {
  const agent = agents().find(a => a.id === run.agent);
  return { runId: run.id, agent: `${agent.title} (${agent.id})`, status: run.status, result: run.result.slice(0, RESULT_CHARS), files: run.files };
};

async function wait({ runIds, seconds = DEFAULT_WAIT_S }) {
  const deadline = Date.now() + Math.min(seconds, MAX_WAIT_S) * 1000;
  for (;;) {
    const mine = agents().filter(a => a.parent === ME.agent).map(a => a.id);
    const runs = tasks.runsOf(ME.task).filter(r => (runIds ? runIds.includes(r.id) : mine.includes(r.agent)));
    const finished = runs.filter(r => r.status !== 'running' && (runIds || !r.collected));
    const questions = tasks.pendingFor(ME.task, ME.agent).filter(q => !q.notified);
    const running = runs.filter(r => r.status === 'running').map(r => r.id);
    if (finished.length || questions.length || !running.length || Date.now() >= deadline) {
      finished.forEach(r => tasks.updateRun(ME.task, r.id, { collected: true }));
      questions.forEach(q => tasks.markNotified(ME.task, q.id));
      return json({ finished: finished.map(reportOf), questions: questions.map(({ id, from, text: body, choices }) => ({ id, from, text: body, choices })), running });
    }
    await sleep(POLL_MS);
  }
}

function answer({ questionId, text: reply }) {
  const question = tasks.readQuestion(ME.task, questionId);
  if (!question || question.to !== ME.agent) throw new Error('That question was not asked to you.');
  tasks.answer(ME.task, questionId, reply, ME.agent);
  return 'Answered.';
}

async function askUp({ question, choices, handoffPrompt, questionId, passes }) {
  const asked = questionId ? tasks.readQuestion(ME.task, questionId) : tasks.ask(ME.task, {
    from: ME.agent, to: me().parent || 'user', text: question, choices, handoffPrompt, passes,
  });
  const deadline = Date.now() + DEFAULT_WAIT_S * 1000;
  for (;;) {
    const current = tasks.readQuestion(ME.task, asked.id);
    if (current.answer !== undefined) return json({ answer: current.answer });
    if (Date.now() >= deadline) return json({ pending: asked.id });
    await sleep(POLL_MS);
  }
}

function runs() {
  const reports = agents().filter(a => a.parent === ME.agent);
  return json(reports.map(a => {
    const latest = tasks.runsOf(ME.task).filter(r => r.agent === a.id).pop();
    return { agent: a.id, title: a.title, account: accountName(a.account), run: latest?.id || null, status: latest?.status || 'not started', questions: tasks.pendingFor(ME.task, a.id).length };
  }));
}

const kindSpec = object({ title: text('Free-text title, for example "UI/UX lead"'), kind: { type: 'string', enum: KINDS }, account: text('Preferred account name (optional)') }, ['title', 'kind']);
const BOTH = ['leader', 'lead'];

const TASK_TOOLS = [
  { name: 'create_team', roles: ['leader'], run: createTeam, inputSchema: object({
    name: text('Team name'), purpose: text('What the team is for'), lead: kindSpec, members: { type: 'array', items: kindSpec },
  }, ['name', 'purpose', 'lead']), description: 'Create a team with a lead and members on the eligible accounts. It starts no work; use delegate.' },
  { name: 'delegate', roles: BOTH, run: delegate, inputSchema: object({
    to: { description: 'Agent id of a direct report; the leader can instead pass { title, kind, account? } for a solo agent', anyOf: [{ type: 'string' }, kindSpec] },
    task: text('A self-contained task'), files: { type: 'array', items: { type: 'string' }, description: 'Files the agent owns' },
  }, ['to', 'task']), description: 'Give a task to a direct report. Returns a run id at once; the work happens in the background. Use wait to collect the report.' },
  { name: 'wait', roles: BOTH, run: wait, inputSchema: object({
    runIds: { type: 'array', items: { type: 'string' } }, seconds: { type: 'number', description: `Up to ${MAX_WAIT_S}; default ${DEFAULT_WAIT_S}` },
  }), description: 'Wait for reports and questions from your direct reports. Returns early when a run finishes or someone asks a question; call again if runs are still going.' },
  { name: 'answer', roles: BOTH, run: answer, inputSchema: object({ questionId: text('Question id'), text: text('Your answer') }, ['questionId', 'text']),
    description: "Answer a direct report's question." },
  { name: 'ask_up', roles: ['leader', 'lead', 'member'], run: askUp, inputSchema: object({
    question: text('The question, with what you need decided'), choices: { type: 'array', items: { type: 'string' } },
    handoffPrompt: text('A prompt for the user to run elsewhere, for work no agent can do'),
    questionId: text('Pass an id returned as pending to keep waiting for that answer'), passes: text("Id of a direct report's question you are passing up"),
  }), description: 'Ask your parent (the user, for the leader) a question and wait for the answer. If the result is pending, call again with questionId.' },
  { name: 'runs', roles: BOTH, run: runs, inputSchema: object(), description: 'The status of every direct report.' },
];

module.exports = { TASK_TOOLS, pickAccount };
