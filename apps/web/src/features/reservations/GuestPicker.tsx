import { useEffect, useRef, useState } from 'react';
import { Search, X, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { searchContacts } from '@/lib/api/booking';
import type { Contact } from '@/types';

export interface PickedGuest {
  id: string;
  name: string;
}

interface Props {
  value: PickedGuest | null;
  onChange: (guest: PickedGuest | null) => void;
  disabled?: boolean;
}

/** Search-and-select a guest by name (reuses the contacts search endpoint). */
export function GuestPicker({ value, onChange, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    searchContacts(debounced)
      .then((r) => !cancelled && setResults(r))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
        <span className="flex items-center gap-2 font-medium text-slate-800">
          <Check className="h-4 w-4 text-emerald-600" /> {value.name}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-slate-400 hover:text-slate-700"
            title="Change guest"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="pl-8"
          placeholder="Search guest by name…"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {loading && <Spinner className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}
      </div>
      {open && debounced.length >= 2 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {results.length === 0 && !loading ? (
            <li className="px-3 py-2 text-sm text-slate-400">No guests match “{debounced}”.</li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange({ id: c.id, name: c.name });
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full flex-col items-start px-3 py-2 text-left text-sm hover:bg-slate-100"
                >
                  <span className="font-medium text-slate-800">{c.name}</span>
                  {(c.email || c.phone) && <span className="text-xs text-slate-500">{c.email || c.phone}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
