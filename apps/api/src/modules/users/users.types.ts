import { z } from 'zod';
import type { RequestMeta } from '../auth/auth.types.js';

// Roles are FIXED (seeded in migrations 011/053) — this screen assigns them, never creates them.
export const ASSIGNABLE_ROLES = [
  'admin',
  'operations',
  'reception',
  'accounts',
  'maintenance',
  'housekeeping',
  'contractor',
] as const;

export const RoleNameEnum = z.enum(ASSIGNABLE_ROLES);
export type RoleName = z.infer<typeof RoleNameEnum>;

// Matches the seeded-admin convention (Admin@123!): 8+ chars with upper, lower,
// digit and symbol.
export const PasswordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[0-9]/, 'Password needs a number')
  .regex(/[^A-Za-z0-9]/, 'Password needs a symbol (e.g. ! or @)');

export const CreateUserSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().toLowerCase().trim(),
  password: PasswordSchema,
  role: RoleNameEnum,
  is_lead: z.boolean().optional().default(false),
  // Permission names granted ON TOP of the role (second-hat staff).
  extra_permissions: z.array(z.string().min(1).max(100)).max(100).optional().default([]),
  // Properties this user may enter (multi-property scope). Empty = no property
  // access yet (admin is a wildcard regardless of this list).
  property_ids: z.array(z.string().uuid()).max(100).optional().default([]),
});

export const UpdateUserSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    role: RoleNameEnum.optional(),
    active: z.boolean().optional(),
    is_lead: z.boolean().optional(),
    extra_permissions: z.array(z.string().min(1).max(100)).max(100).optional(),
    property_ids: z.array(z.string().uuid()).max(100).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'No fields to update',
  });

export const ResetPasswordSchema = z.object({ password: PasswordSchema });

export type CreateUserDTO = z.infer<typeof CreateUserSchema>;
export type UpdateUserDTO = z.infer<typeof UpdateUserSchema>;
export type ResetPasswordDTO = z.infer<typeof ResetPasswordSchema>;

/** Staff user as returned to the client — never includes the password hash. */
export interface StaffUser {
  id: string;
  name: string;
  email: string;
  role: RoleName;
  active: boolean;
  is_lead: boolean;
  extra_permissions: string[];
  property_ids: string[];
  created_at: Date;
  updated_at: Date;
}

/** Role with its permission names — feeds the role dropdown + second-hat toggle. */
export interface RoleInfo {
  id: number;
  name: string;
  permissions: string[];
}

export interface UsersRequestMeta extends RequestMeta {
  userId: string;
}
