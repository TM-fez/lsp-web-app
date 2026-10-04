import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { useAuthStore } from '@/store/auth';
import { homePathFor, permForPath } from './nav';

interface Props {
  children: ReactNode;
}

/**
 * Shows a plain "you don't have access" page when the signed-in user's role lacks the
 * permission the screen at this URL needs (see permForPath). The server already refuses
 * the data — this only stops the screen pretending to load it. Per-element gating
 * (buttons, sections) inside a screen is unchanged.
 */
export function RouteGuard({ children }: Props) {
  const { pathname } = useLocation();
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const perm = permForPath(pathname);
  if (!perm || hasPerm(perm)) return <>{children}</>;
  return <NoAccess />;
}

/** The plain "this page isn't yours" screen — also what `/` shows to a role with no screens at all. */
export function NoAccess() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const home = homePathFor(hasPerm);
  return (
    <div className="mx-auto max-w-xl py-10">
      <EmptyState
        icon={<ShieldOff className="h-8 w-8" />}
        title="You don’t have access to this page"
        description="Your role doesn’t include this screen. If you need it for your work, ask an admin to add it under Users & Roles."
        action={
          home ? (
            <Link to={home} className={buttonVariants({ variant: 'outline' })}>
              Go to my home page
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
