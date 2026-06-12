import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
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
    <div className="grain grid h-full grid-cols-1 bg-cream lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-forest p-12 text-cream lg:flex">
        <div className="animate-rise">
          <div className="text-[13px] font-semibold uppercase tracking-[0.32em]">Lifestyle</div>
          <div className="-mt-1 font-display text-3xl italic text-oncream">Apartments</div>
        </div>
        <div className="animate-rise d-2">
          <div className="mb-5 text-[11px] uppercase tracking-[0.28em] text-oncream">Gaborone — operations</div>
          <h1 className="font-display text-6xl font-medium leading-[0.95]">
            Where Gaborone
            <br />
            <em className="italic text-cream">stays.</em>
          </h1>
        </div>
        <div className="animate-rise d-3 font-display text-lg italic text-oncream">Normal is boring.</div>
      </aside>

      <main className="flex items-center justify-center p-6">
        <div className="animate-rise d-2 w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="text-[13px] font-semibold uppercase tracking-[0.32em] text-ink">Lifestyle</div>
            <div className="-mt-1 font-display text-3xl italic text-forest">Apartments</div>
          </div>

          <div className="mb-7">
            <div className="mb-3 text-[11px] uppercase tracking-[0.28em] text-muted">The house, this morning</div>
            <h2 className="font-display text-4xl text-ink">Welcome back.</h2>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-[11px] uppercase tracking-[0.18em] text-muted">Email</Label>
              <Input id="email" type="email" autoComplete="username" {...register('email')} />
              {errors.email && <p className="text-xs text-terra">{errors.email.message}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-[11px] uppercase tracking-[0.18em] text-muted">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
              {errors.password && <p className="text-xs text-terra">{errors.password.message}</p>}
            </div>

            {error && <p className="text-sm text-terra">{error}</p>}

            <Button type="submit" variant="primary" disabled={isSubmitting} className="mt-3 h-11">
              {isSubmitting && <Spinner className="text-cream" />}
              Enter the cockpit
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
