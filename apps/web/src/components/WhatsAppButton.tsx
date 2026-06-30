import { MessageCircle } from 'lucide-react';
import { whatsappLink } from '@/lib/utils/whatsapp';
import { cn } from '@/lib/utils/cn';

interface Props {
  phone: string | null | undefined;
  /** Optional prefilled message text. */
  message?: string;
  label?: string;
  className?: string;
}

/**
 * Opens WhatsApp (wa.me) for the given phone in a new tab, optionally with a
 * prefilled message. Renders nothing when there's no usable phone number, so it
 * can be dropped in unconditionally.
 */
export function WhatsAppButton({ phone, message, label = 'WhatsApp', className }: Props) {
  const href = whatsappLink(phone, message);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100',
        className,
      )}
    >
      <MessageCircle className="h-4 w-4" /> {label}
    </a>
  );
}
