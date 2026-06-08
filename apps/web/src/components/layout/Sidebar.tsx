import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BedDouble, Tags, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils/cn';

const nav = [
  { to: '/', label: 'Cockpit', icon: LayoutDashboard, perm: 'cockpit.read' },
  { to: '/rooms', label: 'Rooms', icon: BedDouble, perm: 'rooms.read' },
  { to: '/pricing', label: 'Pricing', icon: Tags, perm: 'pricing.read' },
];

export function Sidebar() {
  const hasPerm = useAuthStore((s) => s.hasPerm);

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-4 py-4">
        <Sparkles className="h-5 w-5 text-emerald-600" />
        <span className="text-sm font-semibold tracking-tight">LSP Operations</span>
      </div>
      <nav className="flex flex-col gap-1 px-2">
        {nav
          .filter((item) => hasPerm(item.perm))
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end
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
          ))}
      </nav>
    </aside>
  );
}
