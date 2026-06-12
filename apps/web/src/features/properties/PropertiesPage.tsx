import { useState } from 'react';
import { Building2, Plus, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { useAuthStore } from '@/store/auth';
import { useProperties } from './hooks';
import { PropertyFormDrawer, BuildingFormDrawer } from './PropertyDrawers';
import type { Property, Building } from '@/types';

export function PropertiesPage() {
  const hasPerm = useAuthStore((s) => s.hasPerm);
  const canManage = hasPerm('properties.create') || hasPerm('properties.update');

  const { data: properties, isLoading, isError, refetch } = useProperties();

  const [propOpen, setPropOpen] = useState(false);
  const [editingProp, setEditingProp] = useState<Property | null>(null);

  const [bldOpen, setBldOpen] = useState(false);
  const [bldProperty, setBldProperty] = useState<Property | null>(null);
  const [editingBld, setEditingBld] = useState<Building | null>(null);

  function openCreateProp() { setEditingProp(null); setPropOpen(true); }
  function openEditProp(p: Property) { setEditingProp(p); setPropOpen(true); }
  function openAddBuilding(p: Property) { setBldProperty(p); setEditingBld(null); setBldOpen(true); }
  function openEditBuilding(p: Property, b: Building) { setBldProperty(p); setEditingBld(b); setBldOpen(true); }

  const total = properties?.reduce((s, p) => s + p.units, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-4xl text-ink">Properties</h1>
          <p className="text-sm text-slate-500">
            {properties
              ? `${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} · ${total} unit${total === 1 ? '' : 's'}`
              : 'Locations, their buildings, and the units inside'}
          </p>
        </div>
        {hasPerm('properties.create') && (
          <Button variant="primary" onClick={openCreateProp}>
            <Plus className="h-4 w-4" /> Add property
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
      ) : isError ? (
        <EmptyState
          title="Couldn’t load properties"
          description="The server didn’t respond. Check the API is running and try again."
          action={<Button variant="outline" onClick={() => refetch()}>Retry</Button>}
        />
      ) : (properties?.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Building2 className="h-8 w-8" />}
          title="No properties yet"
          description="Add a property (a location or compound), then add its buildings and assign units to them."
          action={hasPerm('properties.create') ? (
            <Button variant="primary" onClick={openCreateProp}><Plus className="h-4 w-4" /> Add your first property</Button>
          ) : null}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {(properties ?? []).map((p) => (
            <div key={p.id} className="overflow-hidden rounded-lg border border-line bg-paper">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-display text-2xl text-ink">{p.name}</span>
                    {!p.active && <Badge tone="slate">inactive</Badge>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                    {p.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {p.location}</span>}
                    <span>{p.buildings.length} building{p.buildings.length === 1 ? '' : 's'} · {p.units} unit{p.units === 1 ? '' : 's'}</span>
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    {hasPerm('buildings.create') && (
                      <Button size="sm" variant="outline" onClick={() => openAddBuilding(p)}>
                        <Plus className="h-3.5 w-3.5" /> Building
                      </Button>
                    )}
                    {hasPerm('properties.update') && (
                      <Button size="sm" variant="ghost" onClick={() => openEditProp(p)}>Edit</Button>
                    )}
                  </div>
                )}
              </div>

              {p.buildings.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No buildings yet — add one to start placing units.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {p.buildings.map((b) => (
                      <tr key={b.id} className="border-b border-line last:border-0 transition-colors duration-300 hover:bg-cream-2">
                        <td className="px-5 py-3">
                          <span className="font-display text-lg text-ink">{b.name}</span>
                          {b.code && <span className="ml-2 text-xs text-muted">{b.code}</span>}
                          {!b.active && <Badge tone="slate" className="ml-2">inactive</Badge>}
                        </td>
                        <td className="px-5 py-3 text-slate-600">{b.units} unit{b.units === 1 ? '' : 's'}</td>
                        <td className="px-5 py-3 text-right">
                          {hasPerm('buildings.update') && (
                            <Button size="sm" variant="ghost" onClick={() => openEditBuilding(p, b)}>Edit</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}

      <PropertyFormDrawer open={propOpen} onOpenChange={setPropOpen} property={editingProp} />
      {bldProperty && (
        <BuildingFormDrawer
          open={bldOpen}
          onOpenChange={setBldOpen}
          propertyId={bldProperty.id}
          propertyName={bldProperty.name}
          building={editingBld}
        />
      )}
    </div>
  );
}
