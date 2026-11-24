'use strict';
// The system prompt a run gets for its role in a task, and the crew line shared with the hub's crew tool.

function crewLine(agent, flags = '') {
  return `- ${agent.name}${flags}: ${agent.tier} · ${agent.model || 'default'}${agent.effort ? `/${agent.effort}` : ''} · roles: ${agent.roles.join(', ')} · ${agent.status}`;
}

const ROLE_PARTS = {
  leader: ({ crewLines }) => `You lead this task. Do the work yourself unless parts are clearly separable or need another agent's kind of work. To get help: create_team for a group with a lead (for example "UI/UX team"), or delegate to a solo agent. Give each delegation a self-contained task and the files it owns. Use wait to collect reports and questions; answer what you can, ask_up the rest.
Eligible accounts:
${crewLines}
If raster images are needed and no eligible agent has the images kind, ask_up with choices ["Skip", "Use SVG instead", "I'll make it in ChatGPT"] and handoffPrompt set to the image prompt.`,
  lead: ({ team, purpose, members }) => `You lead the ${team} team for: ${purpose}. Members: ${members.map(m => `${m.title} (${m.id})`).join(', ') || 'none'}. Split your work among them with delegate, or do it yourself. Collect with wait, answer member questions or ask_up. Members may only touch the files you assign.`,
  member: ({ files }) => `You own these files: ${files || 'as instructed'}. Do not modify other files.`,
};

function rolePrompt(context) {
  const { role, title, folder, parent, vault } = context;
  const parentLine = parent ? `you report to ${parent.title} (${parent.account})` : 'you report to the user';
  return [
    `You are ${title} in an Ultron task. Folder: ${folder}. Hierarchy: ${parentLine}; only the leader talks to the user. Work autonomously. Only reversible actions are allowed; if a tool is blocked or you are unsure, call ask_up with a clear question and the options. Your final message is your report: what you did, files changed, anything left open. Keep it under 300 words.`,
    ROLE_PARTS[role](context),
    `This device's memory vault is ${vault}. Call the ultron-hub context tool at the start and remember outcomes and decisions before you finish.`,
  ].join('\n\n');
}

module.exports = { crewLine, rolePrompt };
