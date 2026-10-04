import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { CockpitPage } from '@/features/cockpit/CockpitPage';
import { NoAccess } from '@/components/layout/RouteGuard';
import { homePathFor } from '@/components/layout/nav';

/**
 * `/` is the Operations cockpit, but not every role may open it. Send anyone without
 * cockpit.read to the first screen they can use instead of a forbidden page.
 *
 * (Round 4) A role that can open NO screen at all used to fall through to the cockpit — an
 * empty shell whose every request is refused. It now gets the plain "no access" page.
 */
export function HomeRoute() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const home = homePathFor(hasPerm);
  if (home === null) return <NoAccess />;
  return home !== '/' ? <Navigate to={home} replace /> : <CockpitPage />;
}
