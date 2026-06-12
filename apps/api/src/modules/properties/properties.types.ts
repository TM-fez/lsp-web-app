import { z } from 'zod';

export const CreatePropertySchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  active: z.boolean().default(true),
});

export const UpdatePropertySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(50).nullable().optional(),
  location: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

export const CreateBuildingSchema = z.object({
  name: z.string().min(1).max(200),
  code: z.string().max(50).nullable().optional(),
  active: z.boolean().default(true),
});

export const UpdateBuildingSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(50).nullable().optional(),
  active: z.boolean().optional(),
});

export type CreatePropertyDTO = z.infer<typeof CreatePropertySchema>;
export type UpdatePropertyDTO = z.infer<typeof UpdatePropertySchema>;
export type CreateBuildingDTO = z.infer<typeof CreateBuildingSchema>;
export type UpdateBuildingDTO = z.infer<typeof UpdateBuildingSchema>;

/** A building plus how many active units sit in it. */
export interface BuildingWithUnits {
  id: string;
  property_id: string;
  name: string;
  code: string | null;
  active: boolean;
  units: number;
}

/** A property with its buildings and total active units (feeds the admin screen + the switcher). */
export interface PropertyWithBuildings {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  active: boolean;
  units: number;
  buildings: BuildingWithUnits[];
}

export interface PropertyRequestMeta {
  userId: string;
  ip?: string;
  requestId?: string;
}
