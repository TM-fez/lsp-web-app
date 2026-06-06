import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { login as apiLogin } from '@/lib/api/auth';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: 'admin@lsp.local', password: 'Admin@123!' },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      const res = await apiLogin(values.email, values.password);
      setAuth(res.accessToken, res.user);
      navigate('/');
    } catch {
      setError('Invalid email or password.');
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Sparkles className="h-7 w-7 text-emerald-600" />
          <h1 className="text-lg font-semibold">LSP Operations</h1>
          <p className="text-sm text-slate-500">Sign in to the cockpit</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="username" {...register('email')} />
            {errors.email && <p className="text-xs text-rose-600">{errors.email.message}</p>}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
            {errors.password && <p className="text-xs text-rose-600">{errors.password.message}</p>}
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          <Button type="submit" variant="primary" disabled={isSubmitting} className="mt-2">
            {isSubmitting && <Spinner className="text-white" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
