import { CockpitRepository } from './cockpit.repository.js';
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
      date: new Date().toISOString().slice(0, 10),
      units,
      arrivals,
      in_house,
      departures,
      housekeeping_queue,
    };
  }
}
