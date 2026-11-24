export function tokens(n) {
  const abs = Math.abs(n || 0);
  const short = (v, unit) => (v >= 100 ? Math.round(v) : +v.toFixed(v >= 10 ? 1 : 2)) + unit;
  if (abs >= 1e9) return short(n / 1e9, 'B');
  if (abs >= 1e6) return short(n / 1e6, 'M');
  if (abs >= 1e3) return short(n / 1e3, 'K');
  return String(Math.round(n || 0));
}

export function duration(ms) {
  const minutes = Math.round((ms || 0) / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return { h, m, text: h ? `${h}h ${m}m` : `${m}m` };
}

export function ago(t) {
  if (!t) return 'Never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return date(t, { day: 'numeric', month: 'short' });
}

export const date = (t, options) => new Date(t).toLocaleDateString(undefined, options);
export const time = (t, options) => new Date(t).toLocaleTimeString(undefined, options);
export const percent = share => `${Math.round(share * 100)}%`;
export const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? '' : 's'}`;

export function greeting(hour = new Date().getHours()) {
  return hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening';
}
