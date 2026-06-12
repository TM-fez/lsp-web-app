import { useLocation } from 'react-router-dom';
import { Hammer } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { getWorkspace, workspaceForPath } from '@/components/layout/nav';

/** Landing for a workspace that has no built screens yet (e.g. Finance). */
export function ComingSoonPage() {
  const location = useLocation();
  const workspace = getWorkspace(workspaceForPath(location.pathname));
  const planned = workspace.items.map((i) => i.label).join(', ');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-4xl text-ink">{workspace.label}</h1>
        <p className="text-sm text-slate-500">This workspace is being built out.</p>
      </div>
      <EmptyState
        icon={<Hammer className="h-8 w-8" />}
        title={`${workspace.label} is coming soon`}
        description={`Planned for this workspace: ${planned}. Each screen will appear in the menu as it ships.`}
      />
    </div>
  );
}
