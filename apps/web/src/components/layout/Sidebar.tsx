import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils/cn';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getWorkspace, landingRoute, workspaceForPath, type WorkspaceId } from './nav';

export function Sidebar() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const location = useLocation();
  const navigate = useNavigate();

  const currentWorkspace = workspaceForPath(location.pathname);
  const workspace = getWorkspace(currentWorkspace);

  function switchWorkspace(id: WorkspaceId) {
    navigate(landingRoute(id, hasPerm));
  }

  // Built items the user can access become links; not-yet-built items stay as
  // muted "Soon" roadmap entries so the full planned workspace is visible.
  const items = workspace.items.filter((item) => (item.built ? !item.perm || hasPerm(item.perm) : true));

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <Sparkles className="h-5 w-5 text-emerald-600" />
        <span className="text-sm font-semibold tracking-tight">LSP Operations</span>
      </div>

      <div className="px-2 pb-3">
        <WorkspaceSwitcher current={currentWorkspace} onSelect={switchWorkspace} />
      </div>

      <nav className="flex flex-col gap-1 px-2">
        {items.map((item) =>
          item.built ? (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ) : (
            <div
              key={item.to}
              aria-disabled="true"
              title="Coming soon"
              className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-300"
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Soon
              </span>
            </div>
          ),
        )}
      </nav>
    </aside>
  );
}
