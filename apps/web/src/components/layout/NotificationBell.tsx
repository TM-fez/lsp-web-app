import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import {
  useNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
} from '@/features/notifications/useNotifications';
import type { NotificationItem } from '@/lib/api/notifications';

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * The notification bell in the top bar: an unread badge plus a dropdown of recent
 * alerts. Opening or clicking an item marks it read; a click with a deep-link
 * navigates there. Follows the PropertySwitcher dropdown pattern (overlay + panel).
 */
export function NotificationBell() {
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const markAllRead = useMarkAllNotificationsRead();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const items = data?.data ?? [];
  const unread = data?.unread_count ?? 0;

  function handleItem(n: NotificationItem) {
    if (!n.read_at) markRead.mutate([n.id]);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-forest/5 hover:text-ink"
        title="Notifications"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-terra px-1 text-[10px] font-medium leading-none text-cream">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 overflow-hidden rounded-md border border-line bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted">Notifications</span>
              {unread > 0 && (
                <button
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                  className="flex items-center gap-1 text-[11px] text-forest transition-colors hover:text-forest/70 disabled:opacity-50"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</div>
              ) : (
                <ul>
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        onClick={() => handleItem(n)}
                        className={`flex w-full flex-col gap-0.5 border-b border-line px-4 py-3 text-left transition-colors last:border-0 hover:bg-forest/5 ${
                          n.read_at ? '' : 'bg-terra/[0.04]'
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          {!n.read_at && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-terra" />}
                          <span className={`text-sm ${n.read_at ? 'text-ink' : 'font-medium text-ink'}`}>{n.title}</span>
                          <span className="ml-auto shrink-0 pl-2 text-[10px] uppercase tracking-[0.1em] text-faint">
                            {timeAgo(n.created_at)}
                          </span>
                        </div>
                        {n.body && <p className="pl-3.5 text-xs leading-snug text-muted">{n.body}</p>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
