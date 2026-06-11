import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listUsers,
  listRoles,
  createUser,
  updateUser,
  resetUserPassword,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/lib/api/users';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { RoleInfo, StaffUser } from '@/types';

const USERS_KEY = ['users'] as const;

export function useUsers() {
  return useQuery<StaffUser[]>({ queryKey: USERS_KEY, queryFn: listUsers });
}

export function useRoles() {
  // Roles are fixed; cache them for the session.
  return useQuery<RoleInfo[]>({ queryKey: ['roles'], queryFn: listRoles, staleTime: Infinity });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: USERS_KEY });
}

export function useCreateUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateUserInput) => createUser(input),
    onSuccess: (u) => {
      toast.success(`${u.name} added — share their login details securely`);
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUserInput }) => updateUser(id, input),
    onSuccess: () => {
      toast.success('Staff member updated');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => resetUserPassword(id, password),
    onSuccess: () => toast.success('Password reset — their old sessions are signed out'),
    onError: (e) => toast.error(errMessage(e)),
  });
}
