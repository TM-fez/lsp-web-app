import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils/cn';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { LifestyleMark } from '@/components/brand/LifestyleMark';
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

  const items = workspace.items.filter((item) => (item.built ? !item.perm || hasPerm(item.perm) : true));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-paper">
      <div className="flex items-center gap-3 px-6 pb-5 pt-7">
        <LifestyleMark className="h-9 w-9 shrink-0 text-forest" />
        <div className="leading-[1.5]">
          <div className="text-[12px] font-medium uppercase tracking-[0.3em] text-ink">Lifestyle</div>
          <div className="text-[12px] font-medium uppercase tracking-[0.3em] text-ink">Apartments</div>
        </div>
      </div>

      <div className="px-4 pb-4">
        <WorkspaceSwitcher current={currentWorkspace} onSelect={switchWorkspace} />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {items.map((item, i) => {
          const no = String(i + 1).padStart(2, '0');
          // NavLink matches on prefix, so a parent stays lit while a child route is
          // open — '/reports' and '/reports/revenue' would both read as active. Any
          // item another item nests under therefore matches exactly. Derived rather
          // than listed so the next nested route does not quietly reintroduce it.
          const exact = item.to === '/' || items.some((o) => o.to.startsWith(`${item.to}/`));
          return item.built ? (
            <NavLink
              key={item.to}
              to={item.to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-[background-color,color] duration-300 ease-[cubic-bezier(.19,1,.22,1)]',
                  isActive ? 'bg-forest text-cream' : 'text-char hover:bg-cream-2',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'font-display text-[11px] italic',
                      isActive ? 'text-oncream' : 'text-terra',
                    )}
                  >
                    {no}
                  </span>
                  <item.icon className="h-[17px] w-[17px] opacity-80 transition-transform duration-500 ease-[cubic-bezier(.19,1,.22,1)] group-hover:translate-x-0.5" />
                  <span className="tracking-[0.01em]">{item.label}</span>
                </>
              )}
            </NavLink>
          ) : (
            <div
              key={item.to}
              aria-disabled="true"
              title="Coming soon"
              className="flex cursor-default items-center gap-3 rounded-md px-3 py-2.5 text-sm text-faint"
            >
              <span className="font-display text-[11px] italic text-faint">{no}</span>
              <item.icon className="h-[17px] w-[17px] opacity-70" />
              <span className="flex-1">{item.label}</span>
              <span className="text-[9px] font-medium uppercase tracking-[0.18em] text-faint">Soon</span>
            </div>
          );
        })}
      </nav>

      <div className="px-6 py-5">
        <div className="font-display text-sm italic leading-snug text-muted">Boutique Luxury Serviced Apartments</div>
      </div>
    </aside>
  );
}
