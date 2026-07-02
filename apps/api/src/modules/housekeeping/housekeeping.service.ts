import { HousekeepingRepository } from './housekeeping.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { HousekeepingTaskRow } from '../../db/types.js';
import type {
  HousekeepingQueryDTO,
  HousekeepingRequestMeta,
  StartCleaningDTO,
  InspectDTO,
  ReadyDTO,
} from './housekeeping.types.js';

export class HousekeepingService {
  constructor(private readonly repo: HousekeepingRepository) {}

  async queue(propertyId?: string) {
    return this.repo.listQueue(propertyId);
  }

  async list(query: HousekeepingQueryDTO, propertyId?: string) {
    return this.repo.findPaginated(query, propertyId);
  }

  async get(id: string): Promise<HousekeepingTaskRow> {
    const task = await this.repo.findById(id);
    if (!task) throw AppError.notFound(`Housekeeping task ${id} not found`);
    return task;
  }

  // Resolve the single live task for a unit, enforcing the expected stage.
  private async liveTask(roomId: string, expected: HousekeepingTaskRow['status']): Promise<HousekeepingTaskRow> {
    const task = await this.repo.findLiveTaskByRoom(roomId);
    if (!task) throw AppError.notFound(`No live housekeeping task for unit ${roomId}`);
    if (task.status !== expected) {
      throw AppError.conflict(`Unit is ${task.status}; expected ${expected} for this action`);
    }
    return task;
  }

  // Stage 1 — Routine Checks. DIRTY (task OPEN) -> CLEANING.
  async start(roomId: string, dto: StartCleaningDTO, meta: HousekeepingRequestMeta): Promise<HousekeepingTaskRow> {
    const task = await this.liveTask(roomId, 'OPEN');
    return this.repo.transition(
      task.id,
      roomId,
      'OPEN',
      {
        status: 'CLEANING',
        assigned_to: dto.assigned_to ?? task.assigned_to,
        started_at: new Date(),
        started_by: meta.userId,
        notes: dto.notes ?? task.notes,
      },
      'CLEANING',
      meta
    );
  }

  // Stage 2 — Supervisor validation. CLEANING (task CLEANING) -> INSPECTED.
  async inspect(roomId: string, dto: InspectDTO, meta: HousekeepingRequestMeta): Promise<HousekeepingTaskRow> {
    const task = await this.liveTask(roomId, 'CLEANING');
    return this.repo.transition(
      task.id,
      roomId,
      'CLEANING',
      { status: 'INSPECTED', inspected_at: new Date(), inspected_by: meta.userId, notes: dto.notes ?? task.notes },
      'INSPECTED',
      meta
    );
  }

  // Stage 3 — Property Manager sign-off. INSPECTED (task INSPECTED) -> READY
  // (task DONE); the unit is assignable again.
  async ready(roomId: string, dto: ReadyDTO, meta: HousekeepingRequestMeta): Promise<HousekeepingTaskRow> {
    const task = await this.liveTask(roomId, 'INSPECTED');
    return this.repo.transition(
      task.id,
      roomId,
      'INSPECTED',
      { status: 'DONE', completed_at: new Date(), signed_off_by: meta.userId, notes: dto.notes ?? task.notes },
      'READY',
      meta
    );
  }
}
