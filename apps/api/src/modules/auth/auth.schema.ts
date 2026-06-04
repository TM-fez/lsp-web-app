import { z } from 'zod';

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
