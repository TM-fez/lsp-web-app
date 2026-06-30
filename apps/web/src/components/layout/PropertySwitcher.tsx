import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { useActivePropertyStore } from '@/store/activeProperty';
import { useMyProperties } from '@/features/auth/useMyProperties';

/**
 * Shows the active property in the top bar. When the user has access to more than
 * one, it's a dropdown to switch — switching refetches every scoped view for the
 * newly-selected property.
 */
export function PropertySwitcher() {
  const { data } = useMyProperties();
  const activePropertyId = useActivePropertyStore((s) => s.activePropertyId);
  const setActiveProperty = useActivePropertyStore((s) => s.setActiveProperty);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const properties = data ?? [];
  const active = properties.find((p) => p.id === activePropertyId);
  if (!active) return null;

  const multi = properties.length > 1;

  function pick(id: string) {
    setOpen(false);
    if (id === activePropertyId) return;
    setActiveProperty(id);
    // Everything below is property-scoped — refetch it all for the new property.
    qc.invalidateQueries();
  }

  if (!multi) {
    return (
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted">
        <Building2 className="h-3.5 w-3.5 text-terra" />
        {active.name}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-sm text-ink transition-colors hover:border-forest"
      >
        <Building2 className="h-4 w-4 text-forest" />
        <span className="max-w-[12rem] truncate">{active.name}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-20 mt-1 w-60 overflow-hidden rounded-md border border-line bg-white shadow-lg">
            {properties.map((p) => (
              <button
                key={p.id}
                onClick={() => pick(p.id)}
                className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm text-ink transition-colors hover:bg-forest/5"
              >
                <span className="min-w-0 truncate">{p.name}</span>
                {p.id === activePropertyId && <Check className="h-4 w-4 shrink-0 text-forest" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
