/** One humanized line of the shared "what's changed" feed. */
export interface ActivityItem {
  id: string;
  actor: string; // staff name, or "System"
  action: string; // humanized phrase, e.g. "updated pricing"
  entity: string;
  created_at: Date;
}
