import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { useActivePropertyStore } from '@/store/activeProperty';
import { useMyProperties } from './useMyProperties';
import type { MyProperty } from '@/types';

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain flex min-h-screen items-center justify-center bg-cream p-8">{children}</div>
  );
}

/**
 * Stands between login and the portal: ensures an active property is chosen
 * before any scoped screen renders. One property → auto-scoped (no picker). More
 * than one → the picker. None → a "contact an admin" message.
 */
export function PropertyGate() {
  const activePropertyId = useActivePropertyStore((s) => s.activePropertyId);
  const setActiveProperty = useActivePropertyStore((s) => s.setActiveProperty);
  const { data, isLoading, isError, refetch } = useMyProperties();

  const properties = data ?? [];
  const valid = !!activePropertyId && properties.some((p) => p.id === activePropertyId);

  // Auto-scope a single-property user — they never see the picker.
  useEffect(() => {
    if (!isLoading && !valid && properties.length === 1) {
      setActiveProperty(properties[0]!.id);
    }
  }, [isLoading, valid, properties, setActiveProperty]);

  if (isLoading) {
    return (
      <Centered>
        <Spinner className="h-6 w-6" />
      </Centered>
    );
  }

  if (isError) {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-ink">Couldn’t load your properties.</p>
          <Button variant="outline" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </Centered>
    );
  }

  if (properties.length === 0) {
    return (
      <Centered>
        <div className="max-w-sm text-center">
          <h1 className="font-display text-3xl text-ink">No property assigned</h1>
          <p className="mt-2 text-sm text-muted">
            Your account isn’t linked to any property yet. Ask an administrator to grant you access.
          </p>
        </div>
      </Centered>
    );
  }

  if (!valid) {
    // Only reached with more than one property — a single one is auto-scoped above.
    return <PropertyPicker properties={properties} onPick={setActiveProperty} />;
  }

  return <Outlet />;
}

function PropertyPicker({
  properties,
  onPick,
}: {
  properties: MyProperty[];
  onPick: (id: string) => void;
}) {
  return (
    <Centered>
      <div className="w-full max-w-md">
        <h1 className="font-display text-4xl text-ink">Choose a property</h1>
        <p className="mt-1 text-sm text-muted">
          Pick which property to work in. You can switch any time from the top bar.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          {properties.map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              className="group flex items-center gap-4 rounded-lg border border-line bg-white px-5 py-4 text-left transition-colors hover:border-forest hover:bg-forest/5"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest/10 text-forest">
                <Building2 className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-xl text-ink">{p.name}</span>
                {p.code && (
                  <span className="block text-[11px] uppercase tracking-[0.14em] text-muted">{p.code}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Centered>
  );
}
