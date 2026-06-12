import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useCreateProperty, useUpdateProperty, useCreateBuilding, useUpdateBuilding } from './hooks';
import type { Property, Building } from '@/types';

export function PropertyFormDrawer({
  open,
  onOpenChange,
  property,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  property?: Property | null;
}) {
  const isEdit = !!property;
  const create = useCreateProperty();
  const update = useUpdateProperty();
  const busy = create.isPending || update.isPending;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [location, setLocation] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(property?.name ?? '');
    setCode(property?.code ?? '');
    setLocation(property?.location ?? '');
    setActive(property?.active ?? true);
  }, [open, property]);

  const valid = name.trim().length > 0;

  async function submit() {
    const input = { name: name.trim(), code: code.trim() || null, location: location.trim() || null };
    if (isEdit) await update.mutateAsync({ id: property!.id, input: { ...input, active } });
    else await create.mutateAsync(input);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${property?.name}` : 'Add a property'}</DialogTitle>
          <DialogDescription>A property is a location or compound (e.g. Village, CBD).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="prop-name">Name</Label>
              <Input id="prop-name" placeholder="e.g. Village" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="prop-code">Short code</Label>
              <Input id="prop-code" placeholder="VLG" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="prop-loc">Location</Label>
            <Input id="prop-loc" placeholder="e.g. Gaborone" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          {isEdit && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="prop-active">Status</Label>
              <Select id="prop-active" value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save' : 'Add property'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function BuildingFormDrawer({
  open,
  onOpenChange,
  propertyId,
  propertyName,
  building,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: string;
  propertyName: string;
  building?: Building | null;
}) {
  const isEdit = !!building;
  const create = useCreateBuilding();
  const update = useUpdateBuilding();
  const busy = create.isPending || update.isPending;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(building?.name ?? '');
    setCode(building?.code ?? '');
    setActive(building?.active ?? true);
  }, [open, building]);

  const valid = name.trim().length > 0;

  async function submit() {
    const input = { name: name.trim(), code: code.trim() || null };
    if (isEdit) await update.mutateAsync({ buildingId: building!.id, input: { ...input, active } });
    else await create.mutateAsync({ propertyId, input });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${building?.name}` : `Add a building to ${propertyName}`}</DialogTitle>
          <DialogDescription>A building is a block within the property (e.g. J1, J2).</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="bld-name">Name</Label>
              <Input id="bld-name" placeholder="e.g. J1" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="bld-code">Short code</Label>
              <Input id="bld-code" placeholder="J1" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          </div>
          {isEdit && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="bld-active">Status</Label>
              <Select id="bld-active" value={active ? 'active' : 'inactive'} onChange={(e) => setActive(e.target.value === 'active')}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={busy || !valid}>
              {busy && <Spinner className="text-white" />} {isEdit ? 'Save' : 'Add building'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
