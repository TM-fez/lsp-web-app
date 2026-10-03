import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';
import { AppShell } from '@/components/layout/AppShell';
import { PropertyGate } from '@/features/auth/PropertyGate';
import { LoginPage } from '@/features/auth/LoginPage';
import { CockpitPage } from '@/features/cockpit/CockpitPage';
import { ReservationsPage } from '@/features/reservations/ReservationsPage';
import { LeadsPage } from '@/features/leads/LeadsPage';
import { GuestsPage } from '@/features/guests/GuestsPage';
import { HousekeepingDashboardPage } from '@/features/housekeeping/HousekeepingDashboardPage';
import { HousekeepingPage } from '@/features/housekeeping/HousekeepingPage';
import { HousekeepingBoardPage } from '@/features/housekeeping/HousekeepingBoardPage';
import { MaintenanceDashboardPage } from '@/features/maintenance/MaintenanceDashboardPage';
import { MaintenancePage } from '@/features/maintenance/MaintenancePage';
import { RoomsPage } from '@/features/rooms/RoomsPage';
import { PropertiesPage } from '@/features/properties/PropertiesPage';
import { PricingPage } from '@/features/pricing/PricingPage';
import { UsersPage } from '@/features/users/UsersPage';
import { ExpensesPage } from '@/features/expenses/ExpensesPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { OwnerStatementsPage } from '@/features/owners/OwnerStatementsPage';
import { OwnerStatementPrintPage } from '@/features/owners/OwnerStatementPrintPage';
import { OperationalCockpitPage } from '@/features/operations/OperationalCockpitPage';
import { MarketingPage } from '@/features/marketing/MarketingPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { InvoiceDocumentPage } from '@/features/invoices/InvoiceDocumentPage';
import { ReportStatementPage } from '@/features/reports/ReportStatementPage';
import { OperatingExpensesPage } from '@/features/operating-expenses/OperatingExpensesPage';
import { PayrollPage } from '@/features/payroll/PayrollPage';
import { FinanceCockpitPage } from '@/features/finance/FinanceCockpitPage';
import { StayPage } from '@/features/stay/StayPage';
import { ManageBookingPage } from '@/features/stay/ManageBookingPage';
import { GuestCheckinPage } from '@/features/stay/GuestCheckinPage';
import { EnquirePage } from '@/features/stay/EnquirePage';
import { FilesPage } from '@/features/files/FilesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { homePathFor } from '@/components/layout/nav';

function ProtectedRoute() {
  const token = useAuthStore((s) => s.accessToken);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/**
 * `/` is the Operations cockpit, but not every role may open it. Send anyone without
 * cockpit.read to the first screen they can use instead of a forbidden page.
 */
function HomeRoute() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const home = homePathFor(hasPerm);
  return home && home !== '/' ? <Navigate to={home} replace /> : <CockpitPage />;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/stay', element: <StayPage /> },
  { path: '/stay/manage', element: <ManageBookingPage /> },
  { path: '/stay/checkin', element: <GuestCheckinPage /> },
  { path: '/enquire', element: <EnquirePage /> },
  {
    element: <ProtectedRoute />,
    children: [
      // Chrome-less, authed — opens clean for printing / save-as-PDF.
      { path: '/invoices/:id/print', element: <InvoiceDocumentPage /> },
      { path: '/reports/print', element: <ReportStatementPage /> },
      { path: '/owners/print', element: <OwnerStatementPrintPage /> },
      {
        // Requires an active property to be chosen before any scoped screen loads.
        element: <PropertyGate />,
        children: [
          // Chrome-less full-screen tablet board (Phase 3) — no sidebar/topbar,
          // meant to be pinned on a housekeeping tablet.
          { path: '/housekeeping/board', element: <HousekeepingBoardPage /> },
          {
            element: <AppShell />,
            children: [
          { path: '/', element: <HomeRoute /> },
          { path: '/reservations', element: <ReservationsPage /> },
          { path: '/leads', element: <LeadsPage /> },
          { path: '/guests', element: <GuestsPage /> },
          { path: '/housekeeping', element: <HousekeepingDashboardPage /> },
          { path: '/housekeeping/all', element: <HousekeepingPage /> },
          { path: '/maintenance', element: <MaintenanceDashboardPage /> },
          { path: '/maintenance/all', element: <MaintenancePage /> },
          { path: '/properties', element: <PropertiesPage /> },
          { path: '/rooms', element: <RoomsPage /> },
          { path: '/pricing', element: <PricingPage /> },
          { path: '/users', element: <UsersPage /> },
          { path: '/expenses', element: <ExpensesPage /> },
          { path: '/reports', element: <ReportsPage /> },
          { path: '/owners', element: <OwnerStatementsPage /> },
          { path: '/operations', element: <OperationalCockpitPage /> },
          { path: '/marketing', element: <MarketingPage /> },
          { path: '/invoices', element: <InvoicesPage /> },
          { path: '/payments', element: <PaymentsPage /> },
          { path: '/operating-expenses', element: <OperatingExpensesPage /> },
          { path: '/payroll', element: <PayrollPage /> },
          { path: '/finance', element: <FinanceCockpitPage /> },
          { path: '/files', element: <FilesPage /> },
          { path: '/settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
