import { HousekeepingRepository } from './housekeeping.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { HousekeepingTaskRow } from '../../db/types.js';
import type {
  HousekeepingQueryDTO,
  HousekeepingRequestMeta,
  StartCleaningDTO,
  InspectDTO,
  ReadyDTO,
  ChecklistItemCreateDTO,
  ChecklistItemUpdateDTO,
  SetCheckDTO,
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
  // Compliance gate: every active checklist item must be ticked first.
  async inspect(roomId: string, dto: InspectDTO, meta: HousekeepingRequestMeta): Promise<HousekeepingTaskRow> {
    const task = await this.liveTask(roomId, 'CLEANING');

    const missing = await this.repo.uncheckedItems(task.id);
    if (missing.length > 0) {
      const preview = missing.slice(0, 3).map((i) => i.label).join(', ');
      throw AppError.conflict(
        `Checklist incomplete — ${missing.length} item${missing.length === 1 ? '' : 's'} unticked (${preview}${missing.length > 3 ? ', …' : ''})`,
      );
    }

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

  // ── Compliance checklist ─────────────────────────────────────────────────────

  /** The full standard (managers see inactive items too, to reactivate them). */
  async checklist(includeInactive = false) {
    return this.repo.listChecklistItems(!includeInactive);
  }

  async addChecklistItem(dto: ChecklistItemCreateDTO, meta: HousekeepingRequestMeta) {
    return this.repo.createChecklistItem(dto.label, dto.sort_order ?? 0, meta);
  }

  async updateChecklistItem(id: string, dto: ChecklistItemUpdateDTO, meta: HousekeepingRequestMeta) {
    const item = await this.repo.updateChecklistItem(id, dto, meta);
    if (!item) throw AppError.notFound('Checklist item not found');
    return item;
  }

  /** A unit's live-task checklist state: every active item + whether it's ticked. */
  async roomChecks(roomId: string) {
    const task = await this.repo.findLiveTaskByRoom(roomId);
    if (!task) throw AppError.notFound(`No live housekeeping task for unit ${roomId}`);
    const [items, checked] = await Promise.all([
      this.repo.listChecklistItems(true),
      this.repo.checkedItemIds(task.id),
    ]);
    const checkedSet = new Set(checked);
    return {
      task_id: task.id,
      task_status: task.status,
      items: items.map((i) => ({ id: i.id, label: i.label, checked: checkedSet.has(i.id) })),
    };
  }

  /** Tick/untick an item while the unit is being cleaned. */
  async setRoomCheck(roomId: string, dto: SetCheckDTO, meta: HousekeepingRequestMeta) {
    const task = await this.liveTask(roomId, 'CLEANING');
    const items = await this.repo.listChecklistItems(true);
    if (!items.some((i) => i.id === dto.item_id)) {
      throw AppError.badRequest('Unknown or inactive checklist item');
    }
    await this.repo.setCheck(task.id, dto.item_id, dto.checked, meta);
    return this.roomChecks(roomId);
  }

  /** Average turnaround (DIRTY → signed-off READY) for the property. */
  async turnaround(propertyId: string, days: number) {
    return { days, ...(await this.repo.turnaround(propertyId, days)) };
  }
}
