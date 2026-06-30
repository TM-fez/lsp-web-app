import { MaintenanceRepository } from './maintenance.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { FilesRepository } from '../files/files.repository.js';
import type {
  CreateWorkOrderDTO, 
  UpdateWorkOrderDTO, 
  CompleteWorkOrderDTO, 
  StartWorkOrderDTO, 
  AssignWorkOrderDTO,
  MaintenanceQueryDTO
} from './maintenance.types.js';

export class MaintenanceService {
  constructor(
    private readonly repo: MaintenanceRepository,
    private readonly filesRepo: FilesRepository
  ) {}

  async list(query: MaintenanceQueryDTO, propertyId?: string) {
    return this.repo.findPaginated(query, propertyId);
  }

  async get(id: string) {
    const order = await this.repo.findByIdWithPeople(id);
    if (!order) throw AppError.notFound('Work order not found');
    return order;
  }

  async openWorkOrder(data: CreateWorkOrderDTO, meta: { userId: string, requestId?: string }, activePropertyId?: string) {
    // Scope: a work order can only be opened against a unit in the active property.
    if (activePropertyId) {
      const roomProperty = await this.repo.roomPropertyId(data.room_id);
      if (roomProperty !== activePropertyId) {
        throw AppError.badRequest('That unit is not in your active property');
      }
    }
    return this.repo.transaction(async (trx) => {
      // Create work order
      const order = await this.repo.create({
        room_id: data.room_id,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        status: 'OPEN',
        reported_by: meta.userId,
        assigned_to: data.assigned_to ?? null,
        contractor_name: data.contractor_name ?? null,
        contractor_phone: data.contractor_phone ?? null,
        cost_amount: data.cost_amount ?? null,
      } as any, meta, trx);

      // Update room to MAINTENANCE
      await this.repo.updateRoomStatus(data.room_id, 'MAINTENANCE', meta, trx);

      return order;
    });
  }

  async assign(id: string, data: AssignWorkOrderDTO, meta: { userId: string, requestId?: string }) {
    const order = await this.get(id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw AppError.conflict(`Cannot assign a ${order.status} work order`);
    }

    if (data.assigned_to && !(await this.repo.isActiveUser(data.assigned_to))) {
      throw AppError.badRequest('Cannot assign to an unknown or inactive staff member');
    }

    return this.repo.update(id, { assigned_to: data.assigned_to }, meta);
  }

  async start(id: string, data: StartWorkOrderDTO, meta: { userId: string, requestId?: string }) {
    const order = await this.get(id);
    if (order.status !== 'OPEN') {
      throw AppError.conflict(`Cannot start work order from status ${order.status}`);
    }

    if (data.before_file_id) {
      const file = await this.filesRepo.findById(data.before_file_id);
      if (!file) throw AppError.badRequest('Invalid before_file_id');
    }

    return this.repo.update(id, { 
      status: 'IN_PROGRESS', 
      before_file_id: data.before_file_id ?? null,
      started_at: new Date() as any
    }, meta);
  }

  async complete(id: string, data: CompleteWorkOrderDTO, meta: { userId: string, requestId?: string }) {
    return this.repo.transaction(async (trx) => {
      const order = await this.repo.findById(id, trx);
      if (!order) throw AppError.notFound('Work order not found');

      if (order.status !== 'IN_PROGRESS' && order.status !== 'BLOCKED') {
        throw AppError.conflict(`Cannot complete work order from status ${order.status}`);
      }

      if (data.after_file_id) {
        const file = await this.filesRepo.findById(data.after_file_id);
        if (!file) throw AppError.badRequest('Invalid after_file_id');
      }

      const updated = await this.repo.update(id, {
        status: 'COMPLETED',
        after_file_id: data.after_file_id ?? null,
        description: data.notes ? (order.description ? order.description + '\n' + data.notes : data.notes) : order.description,
        completed_at: new Date() as any,
        completed_by: meta.userId,
      }, meta, trx);

      // Restore room status
      await this.repo.updateRoomStatus(order.room_id, 'AVAILABLE', meta, trx);

      return updated;
    });
  }

  /**
   * Management sign-off on a completed repair (separate, higher bar than completing
   * it). Records who approved and when. Idempotent guard: only an un-approved,
   * COMPLETED order can be approved.
   */
  async approve(id: string, meta: { userId: string, requestId?: string }) {
    const order = await this.get(id);
    if (order.status !== 'COMPLETED') {
      throw AppError.conflict(`Only a completed work order can be approved (current status: ${order.status})`);
    }
    if (order.approved_at) {
      throw AppError.conflict('This work order has already been approved');
    }

    return this.repo.update(id, {
      approved_by: meta.userId,
      approved_at: new Date() as any,
    }, meta);
  }

  async cancel(id: string, restoreRoom: boolean, meta: { userId: string, requestId?: string }) {
    return this.repo.transaction(async (trx) => {
      const order = await this.repo.findById(id, trx);
      if (!order) throw AppError.notFound('Work order not found');

      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
        throw AppError.conflict(`Cannot cancel work order from status ${order.status}`);
      }

      const updated = await this.repo.update(id, {
        status: 'CANCELLED',
        cancelled_at: new Date() as any
      }, meta, trx);

      if (restoreRoom) {
        await this.repo.updateRoomStatus(order.room_id, 'AVAILABLE', meta, trx);
      }

      return updated;
    });
  }

  async update(id: string, data: UpdateWorkOrderDTO, meta: { userId: string, requestId?: string }) {
    const order = await this.get(id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw AppError.conflict(`Cannot update work order from status ${order.status}`);
    }

    return this.repo.update(id, data, meta);
  }

  /**
   * Set/replace the contractor + cost. Allowed on any non-cancelled order
   * (the invoice often arrives AFTER the repair is completed). Changing the cost
   * voids any prior spend-approval/reconciliation — no spend without approval.
   */
  async setCost(id: string, data: { contractor_name?: string | null; contractor_phone?: string | null; cost_amount?: number | null }, meta: { userId: string, requestId?: string }) {
    const order = await this.get(id);
    if (order.status === 'CANCELLED') {
      throw AppError.conflict('Cannot set a cost on a cancelled work order');
    }
    return this.repo.update(id, {
      contractor_name: data.contractor_name ?? null,
      contractor_phone: data.contractor_phone ?? null,
      cost_amount: data.cost_amount ?? null,
      cost_approved_by: null,
      cost_approved_at: null,
      cost_reconciled_by: null,
      cost_reconciled_at: null,
    }, meta);
  }
}
