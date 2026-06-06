import type { CockpitUnit } from '@/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { UnitTile } from './UnitTile';

export function UnitBoard({ units, onAssign }: { units: CockpitUnit[]; onAssign: (unit: CockpitUnit) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Units</CardTitle>
      </CardHeader>
      <CardContent>
        {units.length === 0 ? (
          <p className="text-sm text-slate-500">No units configured.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {units.map((u) => (
              <UnitTile key={u.room_id} unit={u} onAssign={onAssign} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
