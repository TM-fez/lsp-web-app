import { useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { WORKSPACES, getWorkspace, type WorkspaceId } from './nav';

interface Props {
  current: WorkspaceId;
  onSelect: (id: WorkspaceId) => void;
}

/** Top-of-sidebar dropdown that flips the whole left menu between workspaces. */
export function WorkspaceSwitcher({ current, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = getWorkspace(current);
  const ActiveIcon = active.icon;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(id: WorkspaceId) {
    setOpen(false);
    if (id !== current) onSelect(id);
  }

  return (
    <div ref={ref} className="relative">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Workspace</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="mt-1 flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
      >
        <ActiveIcon className="h-4 w-4 text-slate-500" />
        <span className="flex-1 truncate">{active.label}</span>
        <ChevronsUpDown className="h-4 w-4 text-slate-400" />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {WORKSPACES.map((ws) => {
            const Icon = ws.icon;
            const selected = ws.id === current;
            return (
              <li key={ws.id} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => choose(ws.id)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-100',
                    selected ? 'font-medium text-slate-900' : 'text-slate-600',
                  )}
                >
                  <Icon className="h-4 w-4 text-slate-500" />
                  <span className="flex-1 truncate">{ws.label}</span>
                  {selected && <Check className="h-4 w-4 text-emerald-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
