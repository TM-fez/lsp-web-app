import { Badge } from '@/components/ui/badge';
import type { CockpitUnit } from '@/types';
import { housekeepingTone, roomStatusTone, isAssignable } from './status';
import { cn } from '@/lib/utils/cn';

export function UnitTile({ unit, onAssign }: { unit: CockpitUnit; onAssign: (unit: CockpitUnit) => void }) {
  const assignable = isAssignable(unit.status, unit.housekeeping_status);

  return (
    <button
      type="button"
      disabled={!assignable}
      onClick={() => onAssign(unit)}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors',
        assignable
          ? 'border-emerald-200 bg-white hover:border-emerald-400 hover:bg-emerald-50'
          : 'cursor-default border-slate-200 bg-slate-50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{unit.code}</span>
        <Badge tone={roomStatusTone[unit.status]}>{unit.status.toLowerCase().replace('_', ' ')}</Badge>
      </div>
      <div className="truncate text-xs text-slate-500">{unit.name}</div>
      <div className="flex items-center justify-between gap-2">
        <Badge tone={housekeepingTone[unit.housekeeping_status]}>{unit.housekeeping_status.toLowerCase()}</Badge>
        {assignable && <span className="text-xs font-medium text-emerald-600">Assign →</span>}
      </div>
      {unit.guest_name && (
        <div className="truncate rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">
          {unit.guest_name}
          {unit.check_out_date && <span className="text-slate-400"> · out {unit.check_out_date.slice(5)}</span>}
        </div>
      )}
    </button>
  );
}
