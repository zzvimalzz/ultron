import { badge, skeleton, tip } from './ui.js';
import { ago } from './format.js';

const TONES = { free: 'muted', paid: 'accent', team: 'accent' };
// What to pick when the CLI can't report the plan; each value is a plan name the tier table understands.
const PLANS = { claude: ['Free', 'Pro', 'Max', 'Team'], chatgpt: ['Free', 'Plus', 'Pro', 'Business'] };
export const planChoices = provider => (PLANS[provider] || []).map(name => [name.toLowerCase(), name]);

const DETECT_NOTES = {
  'cli-missing': "The CLI wasn't found, so the plan can't be read.",
  error: "The CLI didn't answer, so the plan can't be read.",
  ok: "The CLI didn't report a plan.",
};
// Why the plan is unknown or set by hand, once a check has run.
export const detectNote = live => ((live.tier === 'unknown' || live.answered) && DETECT_NOTES[live.detectState]) || '';

// "Claude Pro" -> "Pro", "plus" -> "Plus".
const planShort = label => {
  const word = String(label).trim().split(/\s+/).pop();
  return word.charAt(0).toUpperCase() + word.slice(1);
};

// The badge on a card or in the drawer. A signed-out account shows none.
export function planBadge(live) {
  if (live.launchOnly || live.signedIn === false || !live.tier) return '';
  if (live.detecting && !live.plan) return skeleton('36px', '20px');
  if (live.tier === 'unknown') return badge('Plan?', { tone: 'warn', attrs: 'data-plan-ask role="button" tabindex="0"' });
  const note = live.answered ? 'Set by you · click to change' : `${live.plan}${live.checkedAt ? ` · Checked ${ago(live.checkedAt)}` : ''}`;
  const ask = live.answered ? 'data-plan-ask role="button" tabindex="0" ' : '';
  return badge(planShort(live.plan), { tone: `${TONES[live.tier]}${live.answered ? ' answered' : ''}`, attrs: `${ask}data-tip="${tip(note)}"` });
}
