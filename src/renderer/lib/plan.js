import { badge, skeleton, tip } from './ui.js';
import { ago } from './format.js';

const TIER_NAMES = { free: 'Free', paid: 'Paid', team: 'Team' };
const TONES = { free: 'muted', paid: 'accent', team: 'accent' };
export const planChoices = Object.entries(TIER_NAMES);

// "Claude Pro" -> "Pro", "plus" -> "Plus".
const planShort = label => {
  const word = String(label).trim().split(/\s+/).pop();
  return word.charAt(0).toUpperCase() + word.slice(1);
};

// The badge on a card or in the drawer. A signed-out account shows none.
export function planBadge(live) {
  if (live.signedIn === false) return '';
  if (live.detecting && !live.plan) return skeleton('36px', '20px');
  if (live.tier === 'unknown') return badge('Plan?', { tone: 'warn', attrs: 'data-plan-ask role="button" tabindex="0"' });
  const text = live.answered ? TIER_NAMES[live.tier] : planShort(live.plan);
  const note = live.answered ? 'Set by you' : `${live.plan}${live.checkedAt ? ` · Checked ${ago(live.checkedAt)}` : ''}`;
  return badge(text, { tone: `${TONES[live.tier]}${live.answered ? ' answered' : ''}`, attrs: `data-tip="${tip(note)}"` });
}
