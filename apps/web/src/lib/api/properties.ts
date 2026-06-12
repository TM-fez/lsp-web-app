import { api } from './client';
import type { Property, Building } from '@/types';

export async function listProperties(): Promise<Property[]> {
  const { data } = await api.get<Property[]>('/properties');
  return data;
}

export interface PropertyInput {
  name: string;
  code?: string | null;
  location?: string | null;
  active?: boolean;
}

export async function createProperty(input: PropertyInput): Promise<Property> {
  const { data } = await api.post<Property>('/properties', input);
  return data;
}

export async function updateProperty(id: string, input: Partial<PropertyInput>): Promise<Property> {
  const { data } = await api.patch<Property>(`/properties/${id}`, input);
  return data;
}

export interface BuildingInput {
  name: string;
  code?: string | null;
  active?: boolean;
}

export async function createBuilding(propertyId: string, input: BuildingInput): Promise<Building> {
  const { data } = await api.post<Building>(`/properties/${propertyId}/buildings`, input);
  return data;
}

export async function updateBuilding(buildingId: string, input: Partial<BuildingInput>): Promise<Building> {
  const { data } = await api.patch<Building>(`/properties/buildings/${buildingId}`, input);
  return data;
}
