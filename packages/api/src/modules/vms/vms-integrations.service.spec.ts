import { afterEach, describe, expect, it, vi } from 'vitest';
import { VmsIntegrationsService } from './vms-integrations.service';

describe('live inventory sync safety', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it.each([undefined, []])('does not send the sample catalogue for missing items', async customItems => {
    vi.stubEnv('YELLOW_DOG_API_URL', 'https://inventory.example.test');
    vi.stubEnv('YELLOW_DOG_API_KEY', 'test-key');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.fn();
    const service = new VmsIntegrationsService({ vmsInventorySyncLog: { create: log } } as any);
    await expect(service.syncInventory({ organizationId: 'org', facilityId: 'facility', customItems })).rejects.toThrow('explicit inventory items');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('sends only supplied items and does not invent stock for an empty response', async () => {
    vi.stubEnv('YELLOW_DOG_API_URL', 'https://inventory.example.test');
    vi.stubEnv('YELLOW_DOG_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new VmsIntegrationsService({ vmsInventorySyncLog: { create: vi.fn() } } as any);
    const items = [{ sku: 'real-sku', name: 'Radio', quantity: 3 }];
    const result = await service.syncInventory({ organizationId: 'org', facilityId: 'facility', customItems: items });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ facilityId: 'facility', items });
    expect(result.supplies).toEqual([]);
    expect(result.itemsSynced).toBe(0);
  });
});
