import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { pulaToThebe, thebeToPula, pctToBps, bpsToPct } from '@/lib/utils/money';
import { useCreateRatePlan, useUpdateRatePlan, useDeleteRatePlan } from './hooks';
import type { RatePlanInput } from '@/lib/api/pricing';
import type { RatePlan, UnitType } from '@/types';

const UNIT_TYPES: UnitType[] = ['STANDARD', 'DELUXE', 'SUITE', 'CONFERENCE', 'CUSTOM'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan?: RatePlan | null;
  canDelete?: boolean;
}

export function RatePlanFormDrawer({ open, onOpenChange, plan, canDelete }: Props) {
  const isEdit = !!plan;
  const create = useCreateRatePlan();
  const update = useUpdateRatePlan();
  const remove = useDeleteRatePlan();
  const busy = create.isPending || update.isPending || remove.isPending;

  const [unitType, setUnitType] = useState<UnitType>('STANDARD');
  const [name, setName] = useState('');
  const [nightly, setNightly] = useState('');
  const [weekly, setWeekly] = useState('');
  const [monthly, setMonthly] = useState('');
  const [minNights, setMinNights] = useState(1);
  const [maxGuests, setMaxGuests] = useState(2);
  const [depositPct, setDepositPct] = useState(50);
  const [taxPct, setTaxPct] = useState('14');
  const [currency, setCurrency] = useState('BWP');
  const [active, setActive] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUnitType(plan?.unit_type ?? 'STANDARD');
    setName(plan?.name ?? '');
    setNightly(plan ? thebeToPula(plan.nightly_rate) : '');
    setWeekly(plan ? thebeToPula(plan.weekly_rate) : '');
    setMonthly(plan ? thebeToPula(plan.monthly_rate) : '');
    setMinNights(plan?.min_nights ?? 1);
    setMaxGuests(plan?.max_guests ?? 2);
    setDepositPct(plan?.deposit_pct ?? 50);
    setTaxPct(plan ? bpsToPct(plan.tax_rate_bps) : '14');
    setCurrency(plan?.currency ?? 'BWP');
    setActive(plan?.active ?? true);
    setConfirmDelete(false);
  }, [open, plan]);

  const rates = [nightly, weekly, monthly].map(pulaToThebe);
  const ratesOk = rates.every((r) => !Number.isNaN(r) && r > 0);
  const taxBps = pctToBps(taxPct);
  const valid =
    name.trim().length > 0 &&
    ratesOk &&
    depositPct >= 0 &&
    depositPct <= 100 &&
    !Number.isNaN(taxBps) &&
    minNights >= 1 &&
    maxGuests >= 1;

  function buildInput(): RatePlanInput {
    return {
      unit_type: unitType,
      name: name.trim(),
      nightly_rate: pulaToThebe(nightly),
      weekly_rate: pulaToThebe(weekly),
      monthly_rate: pulaToThebe(monthly),
      min_nights: minNights,
      max_guests: maxGuests,
      deposit_pct: depositPct,
      tax_rate_bps: taxBps,
      currency: (currency.trim().toUpperCase() || 'BWP').slice(0, 3),
      active,
    };
  }

  async function submit() {
    if (!valid) return;
    try {
      if (plan) await update.mutateAsync({ id: plan.id, input: buildInput() });
      else await create.mutateAsync(buildInput());
      onOpenChange(false);
    } catch {
      /* hook surfaces the error toast */
    }
  }

  async function doDelete() {
    if (!plan) return;
    try {
      await remove.mutateAsync(plan.id);
      onOpenChange(false);
    } catch {
      /* toast shown by hook */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${plan?.name}` : 'Add a rate plan'}</DialogTitle>
          <DialogDescription>Rates are entered in {currency || 'BWP'}. Quotes use the active plan for a unit type.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-unit">Unit type</Label>
              <Select id="plan-unit" value={unitType} onChange={(e) => setUnitType(e.target.value as UnitType)}>
                {UNIT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.charAt(0) + t.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-currency">Currency</Label>
              <Input id="plan-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="plan-name">Plan name</Label>
            <Input id="plan-name" placeholder="e.g. Standard — 2025" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <RateField id="plan-nightly" label="Nightly" currency={currency} value={nightly} onChange={setNightly} />
            <RateField id="plan-weekly" label="Weekly" currency={currency} value={weekly} onChange={setWeekly} />
            <RateField id="plan-monthly" label="Monthly" currency={currency} value={monthly} onChange={setMonthly} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-min">Min nights</Label>
              <Input
                id="plan-min"
                type="number"
                min={1}
                value={minNights}
                onChange={(e) => setMinNights(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-guests">Max guests</Label>
              <Input
                id="plan-guests"
                type="number"
                min={1}
                value={maxGuests}
                onChange={(e) => setMaxGuests(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-deposit">Deposit %</Label>
              <Input
                id="plan-deposit"
                type="number"
                min={0}
                max={100}
                value={depositPct}
                onChange={(e) => setDepositPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="plan-tax">Tax (VAT) %</Label>
              <Input id="plan-tax" inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Active (available for new quotes)
          </label>

          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save changes' : 'Create rate plan'}
            </Button>
          </div>

          {isEdit && canDelete && (
            <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-4">
              <Label className="text-rose-600">Danger zone</Label>
              {!confirmDelete ? (
                <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Remove this rate plan
                </Button>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 p-3">
                  <span className="text-sm text-rose-700">Remove “{plan?.name}”?</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={busy}>
                      Keep
                    </Button>
                    <Button variant="danger" onClick={doDelete} disabled={busy}>
                      {busy && <Spinner className="text-white" />} Remove
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RateField({
  id,
  label,
  currency,
  value,
  onChange,
}: {
  id: string;
  label: string;
  currency: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>
        {label} ({currency || 'BWP'})
      </Label>
      <Input id={id} inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
