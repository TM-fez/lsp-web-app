import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnitTile } from './UnitTile';
import type { CockpitUnit } from '@/types';

function unit(overrides: Partial<CockpitUnit> = {}): CockpitUnit {
  return {
    room_id: 'r1',
    name: 'Garden Suite',
    code: 'A1',
    type: 'STANDARD',
    status: 'AVAILABLE',
    housekeeping_status: 'READY',
    capacity: 2,
    guest_name: null,
    occupancy_id: null,
    reservation_id: null,
    check_out_date: null,
    ...overrides,
  };
}

describe('UnitTile', () => {
  it('shows the assign affordance and fires onAssign when ready', () => {
    const onAssign = vi.fn();
    render(<UnitTile unit={unit()} onAssign={onAssign} />);
    expect(screen.getByText('Assign →')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(onAssign).toHaveBeenCalledOnce();
  });

  it('disables the tile and hides assign when not ready', () => {
    const onAssign = vi.fn();
    render(<UnitTile unit={unit({ housekeeping_status: 'DIRTY' })} onAssign={onAssign} />);
    expect(screen.queryByText('Assign →')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows the current guest when occupied', () => {
    render(
      <UnitTile
        unit={unit({ status: 'OCCUPIED', housekeeping_status: 'READY', guest_name: 'Kefilwe M.' })}
        onAssign={vi.fn()}
      />,
    );
    expect(screen.getByText(/Kefilwe M\./)).toBeInTheDocument();
  });

  it('prints checkout as MM-DD even when the API sent an ISO timestamp', () => {
    render(
      <UnitTile
        unit={unit({
          status: 'OCCUPIED',
          housekeeping_status: 'READY',
          guest_name: 'Kefilwe M.',
          check_out_date: '2026-09-06T00:00:00.000Z',
        })}
        onAssign={vi.fn()}
      />,
    );
    expect(screen.getByText(/out 09-06/)).toBeInTheDocument();
    expect(screen.queryByText(/T00:00:00/)).not.toBeInTheDocument();
  });
});
