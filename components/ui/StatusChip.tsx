import type { ReactNode } from 'react';

export function StatusChip({
  children,
  tone = 'cyan',
  pulse = false,
}: {
  children: ReactNode;
  tone?: 'cyan' | 'violet' | 'amber' | 'muted';
  pulse?: boolean;
}) {
  return (
    <span className={`status-chip status-chip--${tone}`}>
      {pulse ? <span className="live-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
