import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  Sparkles,
  Wrench,
  Wallet,
  BarChart3,
  BedDouble,
  Tags,
  ShieldCheck,
  FolderOpen,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type WorkspaceId = 'OPERATIONS' | 'FINANCE' | 'ADMIN';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Permission required to use a BUILT item. Unbuilt items are roadmap-only. */
  perm?: string;
  /** false → rendered as a muted, non-clickable "Soon" entry (the planned shelf). */
  built: boolean;
}

export interface WorkspaceDef {
  id: WorkspaceId;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * The whole left nav, grouped into the three workspaces the mode-switch flips
 * between. Built screens become real links (perm-gated); not-yet-built screens
 * show as "Soon" so the full planned workspace stays visible.
 */
export const WORKSPACES: WorkspaceDef[] = [
  {
    id: 'OPERATIONS',
    label: 'Operations',
    icon: LayoutDashboard,
    items: [
      { to: '/', label: 'Cockpit', icon: LayoutDashboard, perm: 'cockpit.read', built: true },
      { to: '/reservations', label: 'Reservations', icon: CalendarCheck, perm: 'reservations.read', built: true },
      { to: '/guests', label: 'Guests', icon: Users, perm: 'crm.contacts.read', built: true },
      { to: '/housekeeping', label: 'Housekeeping', icon: Sparkles, perm: 'housekeeping.read', built: false },
      { to: '/maintenance', label: 'Maintenance', icon: Wrench, perm: 'maintenance.read', built: false },
    ],
  },
  {
    id: 'FINANCE',
    label: 'Finance',
    icon: Wallet,
    items: [
      { to: '/payments', label: 'Payments & Invoices', icon: Wallet, perm: 'payments.read', built: false },
      { to: '/reports', label: 'Reports', icon: BarChart3, perm: 'reports.read', built: false },
    ],
  },
  {
    id: 'ADMIN',
    label: 'Admin',
    icon: Settings,
    items: [
      { to: '/rooms', label: 'Rooms', icon: BedDouble, perm: 'rooms.read', built: true },
      { to: '/pricing', label: 'Pricing', icon: Tags, perm: 'pricing.read', built: true },
      { to: '/users', label: 'Users & Roles', icon: ShieldCheck, perm: 'users.read', built: false },
      { to: '/files', label: 'Files', icon: FolderOpen, perm: 'files.read', built: false },
      { to: '/settings', label: 'Settings', icon: Settings, built: false },
    ],
  },
];

export const DEFAULT_WORKSPACE: WorkspaceId = 'OPERATIONS';

/**
 * Route that renders a workspace's "coming soon" placeholder, for workspaces with
 * nothing built yet. Only Finance qualifies today.
 */
export const WORKSPACE_PLACEHOLDER: Partial<Record<WorkspaceId, string>> = {
  FINANCE: '/finance',
};

export function getWorkspace(id: WorkspaceId): WorkspaceDef {
  return WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0];
}

/** Which workspace a pathname belongs to (longest-prefix match; URL is the source of truth). */
export function workspaceForPath(pathname: string): WorkspaceId {
  // Placeholder pages keep their own workspace selected.
  for (const [id, path] of Object.entries(WORKSPACE_PLACEHOLDER) as [WorkspaceId, string][]) {
    if (pathname === path) return id;
  }
  let best: { id: WorkspaceId; len: number } | null = null;
  for (const ws of WORKSPACES) {
    for (const item of ws.items) {
      const matches =
        item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(item.to + '/');
      if (matches && (!best || item.to.length > best.len)) {
        best = { id: ws.id, len: item.to.length };
      }
    }
  }
  return best?.id ?? DEFAULT_WORKSPACE;
}

/** Where to navigate when switching INTO a workspace: its first reachable screen. */
export function landingRoute(id: WorkspaceId, hasPerm: (perm: string) => boolean): string {
  const ws = getWorkspace(id);
  const firstPermitted = ws.items.find((i) => i.built && (!i.perm || hasPerm(i.perm)));
  if (firstPermitted) return firstPermitted.to;
  const firstBuilt = ws.items.find((i) => i.built);
  if (firstBuilt) return firstBuilt.to;
  return WORKSPACE_PLACEHOLDER[id] ?? '/';
}
