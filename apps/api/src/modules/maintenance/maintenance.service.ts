import { MaintenanceRepository } from './maintenance.repository.js';
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

  async list(query: MaintenanceQueryDTO) {
    return this.repo.findPaginated(query);
  }

  async get(id: string) {
    const order = await this.repo.findById(id);
    if (!order) throw new Error('Work order not found');
    return order;
  }

  async openWorkOrder(data: CreateWorkOrderDTO, meta: { userId: string, requestId?: string }) {
    return this.repo.transaction(async (trx) => {
      // Create work order
      const order = await this.repo.create({
        room_id: data.room_id,
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        status: 'OPEN',
        reported_by: meta.userId,
      } as any, meta, trx);

      // Update room to MAINTENANCE
      await this.repo.updateRoomStatus(data.room_id, 'MAINTENANCE', meta, trx);

      return order;
    });
  }

  async assign(id: string, data: AssignWorkOrderDTO, meta: { userId: string, requestId?: string }) {
    const order = await this.get(id);
    if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
      throw new Error(`Cannot assign a ${order.status} work order`);
    }

    return this.repo.update(id, { assigned_to: data.assigned_to }, meta);
  }

  async start(id: string, data: StartWorkOrderDTO, meta: { userId: string, requestId?: string }) {
    const order = await this.get(id);
    if (order.status !== 'OPEN') {
      throw new Error(`Cannot start work order from status ${order.status}`);
    }

    if (data.before_file_id) {
      const file = await this.filesRepo.findById(data.before_file_id);
      if (!file) throw new Error('Invalid before_file_id');
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
      if (!order) throw new Error('Work order not found');

      if (order.status !== 'IN_PROGRESS' && order.status !== 'BLOCKED') {
        throw new Error(`Cannot complete work order from status ${order.status}`);
      }

      if (data.after_file_id) {
        const file = await this.filesRepo.findById(data.after_file_id);
        if (!file) throw new Error('Invalid after_file_id');
      }

      const updated = await this.repo.update(id, {
        status: 'COMPLETED',
        after_file_id: data.after_file_id ?? null,
        description: data.notes ? (order.description ? order.description + '\n' + data.notes : data.notes) : order.description,
        completed_at: new Date() as any
      }, meta, trx);

      // Restore room status
      await this.repo.updateRoomStatus(order.room_id, 'AVAILABLE', meta, trx);

      return updated;
    });
  }

  async cancel(id: string, restoreRoom: boolean, meta: { userId: string, requestId?: string }) {
    return this.repo.transaction(async (trx) => {
      const order = await this.repo.findById(id, trx);
      if (!order) throw new Error('Work order not found');

      if (order.status === 'COMPLETED' || order.status === 'CANCELLED') {
        throw new Error(`Cannot cancel work order from status ${order.status}`);
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
      throw new Error(`Cannot update work order from status ${order.status}`);
    }

    return this.repo.update(id, data, meta);
  }
}
