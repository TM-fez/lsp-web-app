export interface DashboardStats {
  totalContacts: number;
  totalUsers: number;
  cachedAt: string;
}

export interface ActivityEntry {
  id: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  entity: string;
  entityId: string;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

export interface DashboardActivityResponse {
  data: ActivityEntry[];
}
