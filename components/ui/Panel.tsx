import type { ReactNode } from 'react';

export function Panel({
  children,
  className = '',
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section className={`glass-panel ${className}`} aria-labelledby={labelledBy}>
      {children}
    </section>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  action,
  id,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <header className="flex items-start justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="mt-1 text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
      </div>
      {action}
    </header>
  );
}
