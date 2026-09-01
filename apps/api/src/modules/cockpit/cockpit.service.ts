import { CockpitRepository } from './cockpit.repository.js';
import { todayInPropertyTZ } from '../../core/time.js';
import { HousekeepingRepository } from '../housekeeping/housekeeping.repository.js';
import type { CockpitBoard } from './cockpit.types.js';

export class CockpitService {
  constructor(
    private readonly repo: CockpitRepository,
    private readonly housekeeping: HousekeepingRepository
  ) {}

  // One unified read of the operating day: units (the spine), the Today rail,
  // and the cleaning queue. All mutations still go to the canonical modules.
  async board(propertyId?: string): Promise<CockpitBoard> {
    const [units, arrivals, in_house, departures, housekeeping_queue] = await Promise.all([
      this.repo.units(propertyId),
      this.repo.arrivals(propertyId),
      this.repo.inHouse(propertyId),
      this.repo.departures(propertyId),
      this.housekeeping.listQueue(propertyId),
    ]);

    return {
      // Africa/Gaborone, not the server's UTC clock: between midnight and 02:00 local
      // a raw toISOString() still reads yesterday, and the rail dates its own "late by"
      // arithmetic off this value.
      date: todayInPropertyTZ(),
      units,
      arrivals,
      in_house,
      departures,
      housekeeping_queue,
    };
  }
}
