import { PropertiesRepository } from './properties.repository.js';
import { AppError } from '../../core/errors/AppError.js';
import type { PropertyRow, BuildingRow } from '../../db/types.js';
import type {
  CreatePropertyDTO,
  UpdatePropertyDTO,
  CreateBuildingDTO,
  UpdateBuildingDTO,
  PropertyRequestMeta,
  PropertyWithBuildings,
} from './properties.types.js';

/** Postgres unique-violation (duplicate name within scope). */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === '23505';
}

export class PropertiesService {
  constructor(private readonly repository: PropertiesRepository) {}

  /** Properties with their buildings + active-unit counts (admin screen + switcher). */
  async listWithBuildings(): Promise<PropertyWithBuildings[]> {
    const [properties, buildings, counts] = await Promise.all([
      this.repository.listProperties(),
      this.repository.listBuildings(),
      this.repository.unitCountsByBuilding(),
    ]);

    return properties.map((p) => {
      const own = buildings
        .filter((b) => b.property_id === p.id)
        .map((b) => ({
          id: b.id,
          property_id: b.property_id,
          name: b.name,
          code: b.code,
          active: b.active,
          units: counts.get(b.id) ?? 0,
        }));
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        location: p.location,
        active: p.active,
        units: own.reduce((sum, b) => sum + b.units, 0),
        buildings: own,
      };
    });
  }

  async createProperty(dto: CreatePropertyDTO, meta: PropertyRequestMeta): Promise<PropertyRow> {
    try {
      return await this.repository.createProperty(
        { name: dto.name, code: dto.code ?? null, location: dto.location ?? null, active: dto.active, created_by: meta.userId, updated_by: meta.userId },
        meta,
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict(`A property named "${dto.name}" already exists`);
      throw e;
    }
  }

  async updateProperty(id: string, dto: UpdatePropertyDTO, meta: PropertyRequestMeta): Promise<PropertyRow> {
    const existing = await this.repository.findPropertyById(id);
    if (!existing) throw AppError.notFound(`Property ${id} not found`);
    try {
      const updated = await this.repository.updateProperty(id, { ...dto, updated_by: meta.userId }, meta);
      if (!updated) throw AppError.notFound(`Property ${id} not found`);
      return updated;
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Another property already uses that name');
      throw e;
    }
  }

  async createBuilding(propertyId: string, dto: CreateBuildingDTO, meta: PropertyRequestMeta): Promise<BuildingRow> {
    const property = await this.repository.findPropertyById(propertyId);
    if (!property) throw AppError.notFound(`Property ${propertyId} not found`);
    try {
      return await this.repository.createBuilding(
        { property_id: propertyId, name: dto.name, code: dto.code ?? null, active: dto.active, created_by: meta.userId, updated_by: meta.userId },
        meta,
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict(`"${property.name}" already has a building named "${dto.name}"`);
      throw e;
    }
  }

  async updateBuilding(id: string, dto: UpdateBuildingDTO, meta: PropertyRequestMeta): Promise<BuildingRow> {
    const existing = await this.repository.findBuildingById(id);
    if (!existing) throw AppError.notFound(`Building ${id} not found`);
    try {
      const updated = await this.repository.updateBuilding(id, { ...dto, updated_by: meta.userId }, meta);
      if (!updated) throw AppError.notFound(`Building ${id} not found`);
      return updated;
    } catch (e) {
      if (isUniqueViolation(e)) throw AppError.conflict('Another building in this property already uses that name');
      throw e;
    }
  }
}
