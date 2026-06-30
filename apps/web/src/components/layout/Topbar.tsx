import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { useActivePropertyStore } from '@/store/activeProperty';
import { Button } from '@/components/ui/button';
import { PropertySwitcher } from './PropertySwitcher';
import { logout as apiLogout } from '@/lib/api/auth';

function useGaboroneClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Gaborone',
  }).format(now);
}

export function Topbar() {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const clearActiveProperty = useActivePropertyStore((s) => s.clear);
  const navigate = useNavigate();
  const time = useGaboroneClock();

  async function handleLogout() {
    try {
      await apiLogout();
    } catch {
      // best-effort; clear locally regardless
    }
    clear();
    clearActiveProperty();
    navigate('/login');
  }

  const initials = (user?.name ?? '')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-cream px-7">
      <PropertySwitcher />
      <div className="flex items-center gap-5">
        <div className="hidden items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-terra" />
          {time} CAT · Gaborone
        </div>
        <div className="flex items-center gap-3 border-l border-line pl-5">
          <div className="text-right leading-tight">
            <div className="text-sm text-ink">{user?.name}</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{user?.role}</div>
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-forest text-[11px] tracking-[0.06em] text-cream">
            {initials}
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout} title="Log out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
