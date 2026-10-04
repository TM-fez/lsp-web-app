/**
 * Each built-in role's permission list, copied from the database after migrations 001-082
 * (role_permissions). It lets the web tests ask "can role X open page Y?" without a server.
 *
 * It is a SNAPSHOT: apps/api/tests/integration/modules/round4-role-permissions-fixture.test.ts
 * fails when the database and this file disagree, which is the prompt to update both the
 * file and the route-guard expectations in router/routeGuards.test.tsx.
 */
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  accounts: [
    'activity.read', 'buildings.read', 'checkins.read', 'contacts:read', 'crm.contacts.read',
    'crm.leads.read', 'dashboard:read', 'expenses.read', 'expenses.reconcile', 'files.create',
    'files.library', 'files.read', 'holds.read', 'invoices.create', 'invoices.read',
    'invoices.refund', 'invoices.update', 'opex.create', 'opex.delete', 'opex.read', 'opex.update',
    'payments.create', 'payments.read', 'payments.update', 'payroll.manage', 'payroll.read',
    'pricing.create', 'pricing.override', 'pricing.read', 'pricing.update', 'properties.read',
    'quotes.read', 'reports.read', 'reservations.read', 'rooms.read',
  ],
  admin: [
    'activity.read', 'availability.read', 'buildings.create', 'buildings.read', 'buildings.update',
    'checkins.create', 'checkins.read', 'checkins.update', 'cockpit.read', 'contacts:create',
    'contacts:delete', 'contacts:read', 'contacts:update', 'crm.contacts.create',
    'crm.contacts.delete', 'crm.contacts.read', 'crm.contacts.update', 'crm.leads.create',
    'crm.leads.delete', 'crm.leads.read', 'crm.leads.update', 'dashboard:read', 'expenses.approve',
    'expenses.read', 'expenses.reconcile', 'files.create', 'files.delete',
    'files.guest_documents.read', 'files.library', 'files.read', 'files:delete', 'files:upload',
    'flags:manage', 'holds.create', 'holds.read', 'holds.update', 'housekeeping.inspect',
    'housekeeping.read', 'housekeeping.signoff', 'housekeeping.update', 'invoices.create',
    'invoices.read', 'invoices.refund', 'invoices.update', 'maintenance.approve',
    'maintenance.complete', 'maintenance.create', 'maintenance.read', 'maintenance.update',
    'maintenance.work', 'opex.create', 'opex.delete', 'opex.read', 'opex.update',
    'payments.create', 'payments.read', 'payments.update', 'payroll.manage', 'payroll.read',
    'pricing.create', 'pricing.override', 'pricing.read', 'pricing.update', 'properties.create',
    'properties.read', 'properties.update', 'quotes.create', 'quotes.read', 'reports.read',
    'reservations.create', 'reservations.delete', 'reservations.discount.approve',
    'reservations.discount.request', 'reservations.read', 'reservations.update',
    'rooms.channel.manage', 'rooms.create', 'rooms.delete', 'rooms.read', 'rooms.update',
    'settings.read', 'settings.update', 'users.create', 'users.read', 'users.reset_password',
    'users.update', 'users:create', 'users:delete', 'users:read', 'users:update',
  ],
  contractor: [
    'files.create', 'files.read', 'maintenance.complete', 'maintenance.read', 'maintenance.work',
  ],
  housekeeping: [
    'activity.read', 'buildings.read', 'checkins.read', 'cockpit.read', 'dashboard:read',
    'housekeeping.read', 'housekeeping.update', 'properties.read', 'rooms.read',
  ],
  maintenance: [
    'activity.read', 'buildings.read', 'dashboard:read', 'maintenance.complete',
    'maintenance.create', 'maintenance.read', 'maintenance.update', 'maintenance.work',
    'properties.read', 'rooms.read', 'rooms.update',
  ],
  operations: [
    'activity.read', 'availability.read', 'buildings.read', 'checkins.create', 'checkins.read',
    'checkins.update', 'cockpit.read', 'contacts:create', 'contacts:delete', 'contacts:read',
    'contacts:update', 'crm.contacts.create', 'crm.contacts.delete', 'crm.contacts.read',
    'crm.contacts.update', 'crm.leads.create', 'crm.leads.delete', 'crm.leads.read',
    'crm.leads.update', 'dashboard:read', 'expenses.approve', 'expenses.read', 'files.create',
    'files.delete', 'files.library', 'files.read', 'files:upload', 'holds.create', 'holds.read',
    'holds.update', 'housekeeping.inspect', 'housekeeping.read', 'housekeeping.signoff',
    'housekeeping.update', 'invoices.read', 'maintenance.approve', 'maintenance.complete',
    'maintenance.create', 'maintenance.read', 'maintenance.update', 'maintenance.work',
    'opex.read', 'payments.read', 'pricing.read', 'properties.read', 'quotes.create',
    'quotes.read', 'reports.read', 'reservations.create', 'reservations.delete',
    'reservations.discount.request', 'reservations.read', 'reservations.update', 'rooms.create',
    'rooms.delete', 'rooms.read', 'rooms.update',
  ],
  reception: [
    'activity.read', 'availability.read', 'buildings.read', 'checkins.create', 'checkins.read',
    'checkins.update', 'cockpit.read', 'contacts:create', 'contacts:read', 'contacts:update',
    'crm.contacts.create', 'crm.contacts.read', 'crm.contacts.update', 'crm.leads.create',
    'crm.leads.read', 'crm.leads.update', 'dashboard:read', 'files.create',
    'files.guest_documents.read', 'files.library', 'files.read', 'files:upload', 'holds.create',
    'holds.read', 'holds.update', 'housekeeping.inspect', 'housekeeping.read',
    'housekeeping.update', 'invoices.read', 'payments.create', 'payments.read', 'payments.update',
    'pricing.read', 'properties.read', 'quotes.create', 'quotes.read', 'reservations.create',
    'reservations.delete', 'reservations.discount.request', 'reservations.read',
    'reservations.update', 'rooms.read',
  ],
};

export const ROLES = Object.keys(ROLE_PERMISSIONS);
