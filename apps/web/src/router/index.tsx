import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { CockpitPage } from '@/features/cockpit/CockpitPage';
import { GuestsPage } from '@/features/guests/GuestsPage';
import { RoomsPage } from '@/features/rooms/RoomsPage';
import { PricingPage } from '@/features/pricing/PricingPage';
import { ComingSoonPage } from '@/features/placeholder/ComingSoonPage';

function ProtectedRoute() {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <CockpitPage /> },
          { path: '/guests', element: <GuestsPage /> },
          { path: '/rooms', element: <RoomsPage /> },
          { path: '/pricing', element: <PricingPage /> },
          { path: '/finance', element: <ComingSoonPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
