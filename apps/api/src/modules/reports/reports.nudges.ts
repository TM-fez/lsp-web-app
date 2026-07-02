/**
 * H6 — rule-based occupancy nudges: the pre-AI version of the Strategy Engine (A5).
 * Pure functions over forward-looking occupancy (booked room-nights ÷ available
 * room-nights for the NEXT 7 and 30 days). No LLM, no magic — just the thresholds
 * a revenue manager would eyeball. When the AI dashboards land, these numbers
 * become their grounding data.
 */

export interface ForwardOccupancyRow {
  property_id: string;
  property_name: string;
  booked_nights_7: number;
  booked_nights_30: number;
  room_count: number;
}

export interface Nudge {
  property_id: string;
  property_name: string;
  tone: 'opportunity' | 'info';
  title: string;
  detail: string;
}

const pct = (n: number) => Math.round(n * 100);

export function buildNudges(rows: ForwardOccupancyRow[]): Nudge[] {
  const nudges: Nudge[] = [];

  for (const r of rows) {
    if (r.room_count <= 0) continue;
    const occ7 = r.booked_nights_7 / (r.room_count * 7);
    const occ30 = r.booked_nights_30 / (r.room_count * 30);

    if (occ7 >= 0.85) {
      nudges.push({
        property_id: r.property_id,
        property_name: r.property_name,
        tone: 'opportunity',
        title: `High demand next week at ${r.property_name}`,
        detail: `${pct(occ7)}% of the next 7 days is already booked — consider firmer rates or minimum-stay rules before discounting anything.`,
      });
    } else if (occ7 <= 0.35) {
      nudges.push({
        property_id: r.property_id,
        property_name: r.property_name,
        tone: 'info',
        title: `Quiet week ahead at ${r.property_name}`,
        detail: `Only ${pct(occ7)}% of the next 7 days is booked — a promo, corporate outreach, or a WhatsApp blast to past guests could fill nights.`,
      });
    }

    if (occ30 >= 0.8) {
      nudges.push({
        property_id: r.property_id,
        property_name: r.property_name,
        tone: 'opportunity',
        title: `Strong month ahead at ${r.property_name}`,
        detail: `${pct(occ30)}% of the next 30 days is booked — this is the moment to nudge nightly rates up, not down.`,
      });
    } else if (occ30 <= 0.3) {
      nudges.push({
        property_id: r.property_id,
        property_name: r.property_name,
        tone: 'info',
        title: `Soft month ahead at ${r.property_name}`,
        detail: `${pct(occ30)}% of the next 30 days is booked — worth planning a campaign now rather than discounting last-minute.`,
      });
    }
  }

  return nudges;
}
