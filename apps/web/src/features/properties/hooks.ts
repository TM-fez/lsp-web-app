import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listProperties,
  createProperty,
  updateProperty,
  createBuilding,
  updateBuilding,
  type PropertyInput,
  type BuildingInput,
} from '@/lib/api/properties';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';
import type { Property } from '@/types';

const PROPS_KEY = ['properties'] as const;

export function useProperties() {
  return useQuery<Property[]>({ queryKey: PROPS_KEY, queryFn: () => listProperties() });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: PROPS_KEY });
    qc.invalidateQueries({ queryKey: ['rooms'] }); // unit counts / names depend on this
  };
}

export function useCreateProperty() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: PropertyInput) => createProperty(input),
    onSuccess: () => { toast.success('Property added'); invalidate(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateProperty() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<PropertyInput> }) => updateProperty(id, input),
    onSuccess: () => { toast.success('Property updated'); invalidate(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useCreateBuilding() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ propertyId, input }: { propertyId: string; input: BuildingInput }) =>
      createBuilding(propertyId, input),
    onSuccess: () => { toast.success('Building added'); invalidate(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}

export function useUpdateBuilding() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ buildingId, input }: { buildingId: string; input: Partial<BuildingInput> }) =>
      updateBuilding(buildingId, input),
    onSuccess: () => { toast.success('Building updated'); invalidate(); },
    onError: (e) => toast.error(errMessage(e)),
  });
}
