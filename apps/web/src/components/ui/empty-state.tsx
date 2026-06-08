import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

interface Props {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

/** A guiding empty state: always say WHY it's empty and WHAT to do next. */
export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center',
        className,
      )}
    >
      {icon && <div className="text-slate-400">{icon}</div>}
      <div className="text-sm font-semibold text-slate-900">{title}</div>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
