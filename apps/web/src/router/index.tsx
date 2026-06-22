import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/features/auth/LoginPage';
import { CockpitPage } from '@/features/cockpit/CockpitPage';
import { ReservationsPage } from '@/features/reservations/ReservationsPage';
import { LeadsPage } from '@/features/leads/LeadsPage';
import { GuestsPage } from '@/features/guests/GuestsPage';
import { HousekeepingPage } from '@/features/housekeeping/HousekeepingPage';
import { MaintenancePage } from '@/features/maintenance/MaintenancePage';
import { RoomsPage } from '@/features/rooms/RoomsPage';
import { PropertiesPage } from '@/features/properties/PropertiesPage';
import { PricingPage } from '@/features/pricing/PricingPage';
import { UsersPage } from '@/features/users/UsersPage';
import { ExpensesPage } from '@/features/expenses/ExpensesPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { InvoiceDocumentPage } from '@/features/invoices/InvoiceDocumentPage';
import { ReportStatementPage } from '@/features/reports/ReportStatementPage';
import { OperatingExpensesPage } from '@/features/operating-expenses/OperatingExpensesPage';
import { PayrollPage } from '@/features/payroll/PayrollPage';
import { ComingSoonPage } from '@/features/placeholder/ComingSoonPage';
import { StayPage } from '@/features/stay/StayPage';

function ProtectedRoute() {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/stay', element: <StayPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      // Chrome-less, authed — opens clean for printing / save-as-PDF.
      { path: '/invoices/:id/print', element: <InvoiceDocumentPage /> },
      { path: '/reports/print', element: <ReportStatementPage /> },
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <CockpitPage /> },
          { path: '/reservations', element: <ReservationsPage /> },
          { path: '/leads', element: <LeadsPage /> },
          { path: '/guests', element: <GuestsPage /> },
          { path: '/housekeeping', element: <HousekeepingPage /> },
          { path: '/maintenance', element: <MaintenancePage /> },
          { path: '/properties', element: <PropertiesPage /> },
          { path: '/rooms', element: <RoomsPage /> },
          { path: '/pricing', element: <PricingPage /> },
          { path: '/users', element: <UsersPage /> },
          { path: '/expenses', element: <ExpensesPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/invoices', element: <InvoicesPage /> },
          { path: '/operating-expenses', element: <OperatingExpensesPage /> },
          { path: '/payroll', element: <PayrollPage /> },
          { path: '/finance', element: <ComingSoonPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
