import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { RouteGuard } from './RouteGuard';
import { titleForPath } from './nav';

/**
 * The authed frame. On a desktop the sidebar sits beside the page as it always has. Below
 * `md` (phones) it would take 240px of a ~390px screen, so it becomes a slide-out menu
 * opened from the top bar — staff and the owner do run this from their phones.
 */
export function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Picking a page closes the phone menu; it should never stay over the screen you chose.
  // The tab title follows the page, so several open tabs can be told apart.
  useEffect(() => {
    setNavOpen(false);
    document.title = titleForPath(location.pathname);
  }, [location.pathname]);

  return (
    <div className="grain flex h-full bg-cream">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <main className="min-h-0 flex-1 overflow-auto bg-cream px-4 py-5 md:px-8 md:py-7">
          <RouteGuard>
            <Outlet />
          </RouteGuard>
        </main>
      </div>
    </div>
  );
}
