import { Phone } from 'lucide-react';
import { normalizePhone } from '@/lib/utils/whatsapp';
import { cn } from '@/lib/utils/cn';

interface Props {
  phone: string | null | undefined;
  label?: string;
  className?: string;
}

/**
 * A plain phone call (tel:) beside the WhatsApp button — one tap from a phone, or the
 * desk's softphone. Uses the same number clean-up as WhatsApp, so a locally typed
 * Botswana number ("71 234 567") dials as +267. Renders nothing without a usable number,
 * so it can be dropped in unconditionally.
 */
export function CallButton({ phone, label = 'Call', className }: Props) {
  const digits = normalizePhone(phone);
  if (!digits) return null;
  return (
    <a
      href={`tel:+${digits}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-line bg-paper px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-cream-2',
        className,
      )}
    >
      <Phone className="h-4 w-4" /> {label}
    </a>
  );
}
