import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen, Upload, Download, ExternalLink, Trash2, Search, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import { useMyProperties } from '@/features/auth/useMyProperties';
import { openFile, downloadFile, type LibraryCategory, type LibraryFile, type FilingCategory } from '@/lib/api/files';
import { cn } from '@/lib/utils/cn';
import { useFilesLibrary, useUploadDocument, useDeleteFile } from './hooks';

/**
 * (P6) Files — one place for every document the business holds.
 *
 * Most files are uploaded somewhere else (a guest's ID at check-in, a receipt on an
 * expense, before/after photos on a repair) and are categorised by what they are
 * attached to, server-side. Only documents that belong to no record — contracts,
 * compliance papers — are filed by hand, here.
 *
 * Guest documents (ID and passport copies) are personal data: the tab only shows for
 * people with files.guest_documents.read (admin and front desk), and the server hides
 * them from everyone else whatever the URL says.
 */

const CATEGORIES: { key: LibraryCategory; label: string }[] = [
  { key: 'GUEST_DOCUMENTS', label: 'Guest documents' },
  { key: 'INCOME_RECEIPTS', label: 'Receipts — income' },
  { key: 'EXPENSE_RECEIPTS', label: 'Receipts — expenses' },
  { key: 'REPAIR_PHOTOS', label: 'Repair photos' },
  { key: 'UNIT_PHOTOS', label: 'Unit photos' },
  { key: 'PROFILE_PICTURES', label: 'Profile pictures' },
  { key: 'CONTRACTS', label: 'Contracts' },
  { key: 'COMPLIANCE', label: 'Compliance' },
  { key: 'OTHER', label: 'Other' },
  { key: 'UNFILED', label: 'Unfiled' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])) as Record<LibraryCategory, string>;

const FILING: { key: FilingCategory; label: string; hint: string }[] = [
  { key: 'CONTRACTS', label: 'Contracts', hint: 'Landlord agreements, leases, supplier contracts' },
  { key: 'COMPLIANCE', label: 'Compliance', hint: 'Business licence, insurance, tax / BURS, fire certificates' },
  { key: 'OTHER', label: 'Other', hint: 'Anything else worth keeping' },
];

/** Where the record a file belongs to lives — the list screen that holds it. */
const LINK_TO: Record<NonNullable<LibraryFile['link_kind']>, { path: string; noun: string } | null> = {
  reservation: { path: '/reservations', noun: 'Booking' },
  invoice: { path: '/invoices', noun: 'Invoice' },
  operating_expense: { path: '/operating-expenses', noun: 'Expense' },
  work_order: { path: '/maintenance/all', noun: 'Repair' },
  room: { path: '/rooms', noun: 'Unit' },
  user: { path: '/users', noun: 'Staff' },
  contact: { path: '/guests', noun: 'Guest' },
};

const PAGE_SIZE = 50;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Gaborone' });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canUpload = hasPerm('files.create');
  const canDelete = hasPerm('files.delete');
  const canSeeGuestDocs = hasPerm('files.guest_documents.read');

  const { data: properties } = useMyProperties();
  const [category, setCategory] = useState<LibraryCategory | 'ALL'>('ALL');
  const [propertyId, setPropertyId] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [uploadOpen, setUploadOpen] = useState(false);

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [category, propertyId, debounced, from, to]);

  const { data, isLoading, isError, refetch } = useFilesLibrary({
    category: category === 'ALL' ? undefined : category,
    property_id: propertyId || undefined,
    search: debounced || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const files = data?.data ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const tabs = CATEGORIES.filter((c) => c.key !== 'GUEST_DOCUMENTS' || canSeeGuestDocs);
  const filtered = category !== 'ALL' || !!propertyId || !!debounced || !!from || !!to;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex animate-rise flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <div className="mb-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-muted">
            <span className="h-px w-10 bg-ink" /> Admin · Gaborone
          </div>
          <h1 className="font-display text-4xl text-ink sm:text-5xl">Files</h1>
          <p className="mt-2 text-sm text-muted">
            Every document and photo in one place — sorted by what it belongs to.
          </p>
        </div>
        {canUpload && (
          <Button variant="primary" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" /> Upload document
          </Button>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        {[{ key: 'ALL' as const, label: 'All' }, ...tabs].map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCategory(c.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs transition-[background-color,color,border-color] duration-300',
              category === c.key ? 'border-forest bg-forest text-cream' : 'border-line bg-paper text-char hover:border-ink',
            )}
          >
            {c.key === 'GUEST_DOCUMENTS' && <Lock className="h-3 w-3" />}
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="File name, guest, invoice or unit"
            className="pl-9"
            aria-label="Search files"
          />
        </div>
        {(properties?.length ?? 0) > 1 && (
          <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} aria-label="Property" className="w-full sm:w-48">
            <option value="">All properties</option>
            {properties!.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
        )}
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="files-from" className="text-xs text-muted">Uploaded from</Label>
            <Input id="files-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="files-to" className="text-xs text-muted">to</Label>
            <Input id="files-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load files"
          description="The server didn’t respond. Check your connection and try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : files.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="h-8 w-8" />}
          title={filtered ? 'No files match' : 'No files yet'}
          description={
            filtered
              ? 'Nothing matches these filters. Clear the search or pick another category to see more.'
              : 'Files appear here as they are added around the app — a guest’s ID at check-in, an expense receipt, a repair photo. Use Upload document for contracts and compliance papers.'
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-paper">
            <table className="w-full min-w-[44rem] whitespace-nowrap text-sm md:whitespace-normal">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.18em] text-muted">
                  <th className="px-4 py-3 font-normal">File</th>
                  <th className="px-4 py-3 font-normal">Category</th>
                  <th className="px-4 py-3 font-normal">Belongs to</th>
                  <th className="px-4 py-3 font-normal">Uploaded</th>
                  <th className="px-4 py-3 font-normal" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <FileRow key={f.id} file={f} canDelete={canDelete} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm text-muted">
            <span>
              Showing <span className="tabnum text-ink">{files.length}</span> of <span className="tabnum text-ink">{total}</span>
            </span>
            {pages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <span className="tabnum">{page} / {pages}</span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            )}
          </div>
        </>
      )}

      <UploadDocumentDrawer open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}

interface FileRowProps {
  file: LibraryFile;
  canDelete: boolean;
}

function FileRow({ file, canDelete }: FileRowProps) {
  const remove = useDeleteFile();
  const [confirming, setConfirming] = useState(false);
  const link = file.link_kind ? LINK_TO[file.link_kind] : null;

  return (
    <tr className="border-b border-line last:border-0">
      <td className="px-4 py-3">
        <div className="text-ink">{file.original_name}</div>
        <div className="text-xs text-muted">{fmtSize(file.size_bytes)}</div>
      </td>
      <td className="px-4 py-3">
        <Badge tone={file.category === 'GUEST_DOCUMENTS' ? 'amber' : file.category === 'UNFILED' ? 'slate' : 'green'}>
          {CATEGORY_LABEL[file.category]}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {link && file.link_label ? (
          <Link to={link.path} className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            {link.noun} · {file.link_label}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        )}
        {file.property_name && <div className="text-xs text-muted">{file.property_name}</div>}
      </td>
      <td className="px-4 py-3">
        <div className="text-ink">{fmtDate(file.created_at)}</div>
        <div className="text-xs text-muted">{file.uploaded_by_name ?? '—'}</div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openFile(file.id)} title="Open">
            <ExternalLink className="h-4 w-4" /> Open
          </Button>
          <Button variant="ghost" size="sm" onClick={() => downloadFile(file.id, file.original_name)} title="Download">
            <Download className="h-4 w-4" /> Download
          </Button>
          {canDelete &&
            (confirming ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-terra"
                disabled={remove.isPending}
                onClick={async () => {
                  try {
                    await remove.mutateAsync(file.id);
                  } catch {
                    /* hook surfaces the error toast */
                  }
                  setConfirming(false);
                }}
              >
                <Trash2 className="h-4 w-4" /> Confirm
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} title="Remove">
                <Trash2 className="h-4 w-4" />
              </Button>
            ))}
        </div>
      </td>
    </tr>
  );
}

interface UploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/gif';
const MAX_BYTES = 10 * 1024 * 1024;

function UploadDocumentDrawer({ open, onOpenChange }: UploadProps) {
  const upload = useUploadDocument();
  const { data: properties } = useMyProperties();
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<FilingCategory | ''>('');
  const [propertyId, setPropertyId] = useState('');

  useEffect(() => {
    if (open) {
      setFile(null);
      setCategory('');
      setPropertyId('');
    }
  }, [open]);

  const tooBig = !!file && file.size > MAX_BYTES;
  const valid = !!file && !tooBig && !!category;

  async function submit() {
    if (!valid) return;
    try {
      await upload.mutateAsync({ file: file!, category: category as FilingCategory, property_id: propertyId || null });
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            For documents that don’t belong to a booking, invoice or repair — those are filed automatically where you upload them.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="upload-file">File</Label>
          <Input id="upload-file" type="file" accept={ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className={cn('text-xs', tooBig ? 'text-terra' : 'text-muted')}>
            {tooBig ? 'That file is over 10 MB — please choose a smaller one.' : 'PDF or photo, up to 10 MB.'}
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm text-ink">Category</legend>
          {FILING.map((c) => (
            <label
              key={c.key}
              className={cn(
                'flex cursor-pointer flex-col rounded-md border px-3 py-2.5 transition-colors',
                category === c.key ? 'border-forest bg-forest/5' : 'border-line hover:border-ink',
              )}
            >
              <span className="flex items-center gap-2 text-sm text-ink">
                <input type="radio" name="filing-category" checked={category === c.key} onChange={() => setCategory(c.key)} />
                {c.label}
              </span>
              <span className="pl-5 text-xs text-muted">{c.hint}</span>
            </label>
          ))}
        </fieldset>

        {(properties?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="upload-property">Property (optional)</Label>
            <Select id="upload-property" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">Not about one property</option>
              {properties!.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || upload.isPending}>
            {upload.isPending ? <Spinner className="text-white" /> : <Upload className="h-4 w-4" />} Upload
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
