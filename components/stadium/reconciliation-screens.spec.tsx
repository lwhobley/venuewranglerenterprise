// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StandSheet from '../../app/stadium/stand-sheet';
import Commissary from '../../app/stadium/commissary';

const mocks = vi.hoisted(() => ({ request: vi.fn(), data: {} as Record<string, unknown>, invalidate: vi.fn() }));
vi.mock('../../lib/api-client', () => ({
  apiRequest: (...args: unknown[]) => mocks.request(...args),
  useApiQuery: (_key: unknown, path: string) => ({ data: mocks.data[path], isLoading: false, refetch: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock('../../lib/theme', () => ({ opsConsole: {} }));
vi.mock('../../lib/responsive', () => ({ useResponsive: () => ({ isPhone: true }) }));
vi.mock('./OpsQueryState', () => ({ OpsQueryState: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../ErrorBoundary', () => ({ RouteErrorBoundary: () => null }));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.request.mockReset();
  mocks.data = {};
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function click(text: string) {
  const button = [...container.querySelectorAll('[role="button"],button')].find(node => node.textContent?.includes(text));
  if (!button) throw new Error(`Missing button: ${text}`);
  await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}
async function fill(label: string, value: string) {
  const input = container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('reconciliation screens', () => {
  it('reconciles opening inventory with explicit counts and measured revenue', async () => {
    const sheet = { id: 'sheet-1', outlet: { name: 'Stand 1' }, status: 'count_in_recorded', inventoryVariance: null, countIn: [{ code: 'water', name: 'Water', count: 10, unitPriceCents: 200 }] };
    mocks.data['/v1/stadium/concourse/stand-sheets'] = [sheet];
    mocks.request.mockResolvedValue({ ...sheet, varianceAmountCents: 0 });
    await act(async () => root.render(<StandSheet />));
    await click('Reconcile counts');
    expect(mocks.request).not.toHaveBeenCalled();
    await fill('Water Count out', '2'); await fill('Water Waste', '1'); await fill('Water POS sold', '7'); await fill('Actual POS revenue', '14.00');
    await click('Reconcile counts');
    expect(mocks.request).toHaveBeenCalledWith('/v1/stadium/concourse/stand-sheets/sheet-1/reconcile', expect.objectContaining({ body: {
      countOutItems: [{ ...sheet.countIn[0], count: 2 }], wasteItems: [{ ...sheet.countIn[0], count: 1 }], posItemsSold: [{ ...sheet.countIn[0], count: 7 }], actualPosRevenueCents: 1400,
    } }));
  });

  it('settles a hawker with recorded returns and balanced tender', async () => {
    const session = { id: 'hawker-1', hawkerName: 'Seller', status: 'active', itemsCheckedOut: [{ code: 'water', name: 'Water', quantity: 10, unitPriceCents: 200 }], grossSalesCents: 0, commissionRateBps: 1000, commissionPayoutCents: 0 };
    mocks.data['/v1/stadium/concourse/hawkers'] = [session];
    mocks.data['/v1/stadium/concourse/transfers'] = [];
    mocks.request.mockResolvedValue({ grossSalesCents: 1600, commissionPayoutCents: 160 });
    await act(async () => root.render(<Commissary />));
    await click('Enter returns');
    await fill('Water returned', '2'); await fill('Cash collected', '0'); await fill('Card collected', '10');
    await click('Confirm settlement');
    expect(mocks.request).not.toHaveBeenCalled();
    await fill('Cash collected', '6');
    await click('Confirm settlement');
    expect(mocks.request).toHaveBeenCalledWith('/v1/stadium/concourse/hawkers/hawker-1/settle', { method: 'POST', body: { itemsCheckedIn: [{ code: 'water', name: 'Water', quantity: 2 }], cashCollectedCents: 600, cardCollectedCents: 1000 } });
  });
});
