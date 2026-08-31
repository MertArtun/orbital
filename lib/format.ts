export function formatCountdown(targetIso: string, now = Date.now()): string {
  const target = Date.parse(targetIso);
  // Both sides have to be finite. Guarding only the target still lets a caller
  // passing a parsed timestamp render "T−NaN:NaN:NaN:NaN" into the launch card.
  if (!Number.isFinite(target) || !Number.isFinite(now)) return 'T−--:--:--:--';
  const delta = target - now;
  const prefix = delta < 0 ? 'T+' : 'T−';
  const total = Math.floor(Math.abs(delta) / 1_000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;

  return `${prefix}${String(days).padStart(2, '0')}:${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`;
}

export function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
