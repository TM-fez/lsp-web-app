import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSettings,
  updateSettings,
  changePassword,
  type UpdateSettingsInput,
  type ChangePasswordInput,
} from '@/lib/api/settings';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';

const SETTINGS_KEY = ['settings'] as const;

export function useSettings(enabled = true) {
  return useQuery({ queryKey: SETTINGS_KEY, queryFn: getSettings, enabled });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) => updateSettings(input),
    onSuccess: (data) => {
      toast.success('Settings saved');
      qc.setQueryData(SETTINGS_KEY, data);
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => changePassword(input),
    onSuccess: () => toast.success('Password changed — you’ve been signed out on other devices'),
    onError: (e) => toast.error(errMessage(e)),
  });
}
