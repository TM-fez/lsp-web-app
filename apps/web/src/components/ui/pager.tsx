import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './button';

interface Props {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
}

/**
 * (Re-test round 3) Lists loaded their first 100 rows and stopped — "100 of 667" with no
 * way to reach the rest. A plain previous / next pager; renders nothing for one page.
 */
export function Pager({ page, limit, total, onPage }: Props) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 text-xs text-muted">
      <span className="tabnum">
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-3.5 w-3.5" /> Previous
        </Button>
        <span className="tabnum">
          Page {page} of {pages}
        </span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </nav>
  );
}
