import { z } from 'zod';
import { PasswordSchema } from '../users/users.types.js';

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  password: z
    .string({ required_error: 'Password is required' })
    .min(1, 'Password is required'),
});

// Refresh and logout tokens arrive via httpOnly cookie — no body schema needed.
// The controller validates cookie presence directly.

export type LoginInput = z.infer<typeof loginSchema>;

// (P7) My account → change password. The new one meets the same rules an admin's reset does.
export const changePasswordSchema = z
  .object({
    current_password: z.string({ required_error: 'Enter your current password' }).min(1, 'Enter your current password'),
    new_password: PasswordSchema,
  })
  .refine((v) => v.current_password !== v.new_password, {
    message: 'Choose a new password that is different from your current one',
    path: ['new_password'],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
