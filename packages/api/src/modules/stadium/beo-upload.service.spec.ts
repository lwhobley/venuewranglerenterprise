import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { BeoUploadService, assertAllowedUpload, resolveServiceWindow } from './beo-upload.service';
import type { SuiteCandidate } from './beo-suite-matching';

/**
 * The guarantee under test: nothing reaches the database because a model read a
 * PDF confidently. A row whose suite could not be resolved blocks the import,
 * and a caller-supplied suite id is re-checked against the venue at commit.
 */

const SUITES: SuiteCandidate[] = [
  { id: 'sv_312', zoneId: 'zone_300', code: 'S-312', name: 'Suite 312' },
  { id: 'sv_314', zoneId: 'zone_300', code: 'S-314', name: 'Suite 314' },
];

const EVENT = {
  id: 'evt_1',
  title: 'Texans vs Colts',
  startsAt: new Date('2026-09-13T18:00:00Z'),
  expectedGuests: 68000,
  organizationId: 'org_1',
};

function buildService(overrides: Record<string, unknown> = {}) {
  const tx = {
    crmBeo: { create: vi.fn().mockResolvedValue({ id: 'crm_abcdef' }) },
    suiteBeoOrder: {
      create: vi.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `sbo_${data.subVenueId}`, beoNumber: data.beoNumber, subVenueId: data.subVenueId }),
      ),
    },
    eventAuditLog: { create: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(0),
  };
  const prisma = {
    venueEvent: { findFirst: vi.fn().mockResolvedValue(EVENT) },
    subVenue: { findMany: vi.fn().mockResolvedValue(SUITES) },
    $transaction: vi.fn(async (cb: any) => cb(tx)),
    ...overrides,
  };
  return { service: new BeoUploadService(prisma as never), prisma, tx };
}

describe('assertAllowedUpload', () => {
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

  it('accepts a PDF whose bytes match the declared type', () => {
    expect(assertAllowedUpload(pdf, 'application/pdf')).toBe('application/pdf');
  });

  it('rejects a file whose bytes contradict the declared type', () => {
    expect(() => assertAllowedUpload(Buffer.from('not a pdf at all'), 'application/pdf')).toThrow(BadRequestException);
  });

  it('rejects an unsupported type outright', () => {
    expect(() => assertAllowedUpload(pdf, 'application/zip')).toThrow(/PDF or a photo/);
  });

  it('rejects an empty file', () => {
    expect(() => assertAllowedUpload(Buffer.alloc(0), 'application/pdf')).toThrow(/empty/);
  });
});

describe('resolveServiceWindow', () => {
  const eventStart = new Date('2026-09-13T18:00:00Z');

  it('puts the document’s clock times on the event’s date', () => {
    const window = resolveServiceWindow(eventStart, '16:30', '17:15');
    expect(window.start.getHours()).toBe(16);
    expect(window.start.getMinutes()).toBe(30);
    expect(window.end.getHours()).toBe(17);
  });

  it('falls back to the window before kickoff when the document states none', () => {
    const window = resolveServiceWindow(eventStart, null, null);
    expect(window.start.getTime()).toBe(eventStart.getTime() - 90 * 60_000);
    expect(window.end.getTime()).toBe(eventStart.getTime() - 30 * 60_000);
  });

  it('rolls an end before its start to the next day rather than inverting it', () => {
    const window = resolveServiceWindow(eventStart, '23:30', '00:30');
    expect(window.end.getTime()).toBeGreaterThan(window.start.getTime());
  });
});

describe('BeoUploadService.normalizeParsedUpload', () => {
  it('matches each row to a suite and reports the tally', () => {
    const { service } = buildService();

    const result = service.normalizeParsedUpload(
      {
        documentTitle: 'Game 1 Suite Catering',
        suites: [
          { suiteLabel: 'Suite 312', hostName: 'Acme', guestCount: 20, serviceStart: '16:30', lineItems: [{ name: 'Wagyu', quantity: 2, unitPriceCents: 45000, category: 'entree' }] },
          { suiteLabel: 'S-314', hostName: 'Globex', guestCount: 12, lineItems: [] },
        ],
      },
      SUITES,
    );

    expect(result.rows).toHaveLength(2);
    // The screen assigns unmatched rows from this list without another call.
    expect(result.venueSuites).toHaveLength(2);
    expect(result.matchedCount).toBe(2);
    expect(result.unmatchedCount).toBe(0);
    expect(result.readyToCommit).toBe(true);
    expect(result.rows[0].totalCents).toBe(90000);
  });

  it('is not ready to commit while a suite is unresolved', () => {
    const { service } = buildService();

    const result = service.normalizeParsedUpload(
      { suites: [{ suiteLabel: 'Suite 999', hostName: 'Nobody', lineItems: [] }] },
      SUITES,
    );

    expect(result.rows[0].match).toBeNull();
    expect(result.unmatchedCount).toBe(1);
    expect(result.readyToCommit).toBe(false);
  });

  it('keeps the label verbatim so a manager can check the mapping', () => {
    const { service } = buildService();

    const result = service.normalizeParsedUpload(
      { suites: [{ suiteLabel: '  Suite #312 (Level 3)  ', hostName: 'Acme', lineItems: [] }] },
      SUITES,
    );

    expect(result.rows[0].suiteLabel).toBe('Suite #312 (Level 3)');
    expect(result.rows[0].match?.subVenueId).toBe('sv_312');
  });

  it('drops rows and items the document did not actually name', () => {
    const { service } = buildService();

    const result = service.normalizeParsedUpload(
      {
        suites: [
          { suiteLabel: '', hostName: 'Ghost', lineItems: [] },
          'not an object',
          { suiteLabel: 'Suite 312', hostName: 'Acme', lineItems: [{ name: 'Real item', quantity: 1, unitPriceCents: 100 }, { quantity: 4 }, null] },
        ],
      },
      SUITES,
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].lineItems).toHaveLength(1);
  });

  it('rejects a response that is not a BEO at all', () => {
    const { service } = buildService();
    expect(() => service.normalizeParsedUpload({ nonsense: true }, SUITES)).toThrow(/could not be read/);
  });

  it('falls back to the suite label when the document names no host', () => {
    const { service } = buildService();
    const result = service.normalizeParsedUpload({ suites: [{ suiteLabel: 'Suite 312', lineItems: [] }] }, SUITES);
    expect(result.rows[0].hostName).toBe('Suite 312');
  });
});

describe('BeoUploadService.commit', () => {
  const row = {
    rowId: 'row-0',
    subVenueId: 'sv_312',
    hostName: 'Acme Corp',
    guestCount: 20,
    serviceStart: '16:30',
    serviceEnd: '17:15',
    specialInstructions: null,
    lineItems: [{ code: 'BF-1', name: 'Wagyu', quantity: 2, unitPriceCents: 45000, category: 'entree' }],
  };

  it('creates one sales BEO and a linked suite order per row', async () => {
    const { service, tx } = buildService();

    const result = await service.commit('ven_1', 'evt_1', { profileId: 'prof_1' }, {
      documentTitle: 'Game 1 Suite Catering',
      rows: [row, { ...row, rowId: 'row-1', subVenueId: 'sv_314' }],
    });

    expect(tx.crmBeo.create).toHaveBeenCalledTimes(1);
    expect(tx.suiteBeoOrder.create).toHaveBeenCalledTimes(2);
    expect(result.suiteOrders).toHaveLength(2);

    const created = tx.suiteBeoOrder.create.mock.calls.map(([args]: any) => args.data);
    // Every suite order points back at the one sales BEO for the document.
    expect(created.every((data: any) => data.crmBeoId === 'crm_abcdef')).toBe(true);
    expect(created[0].totalCents).toBe(90000);
    // Numbers are derived, not taken from the document, so re-importing the
    // same file cannot collide on the per-facility unique beoNumber.
    expect(new Set(created.map((data: any) => data.beoNumber)).size).toBe(2);
  });

  it('refuses to import while any row has no suite', async () => {
    const { service, tx } = buildService();

    await expect(
      service.commit('ven_1', 'evt_1', { profileId: 'prof_1' }, {
        documentTitle: 'Doc',
        rows: [row, { ...row, rowId: 'row-1', subVenueId: '  ' }],
      }),
    ).rejects.toThrow(/Assign a suite to every row/);

    expect(tx.crmBeo.create).not.toHaveBeenCalled();
  });

  it('re-checks the suite belongs to this venue rather than trusting the caller', async () => {
    const { service, tx } = buildService();

    await expect(
      service.commit('ven_1', 'evt_1', { profileId: 'prof_1' }, {
        documentTitle: 'Doc',
        rows: [{ ...row, subVenueId: 'sv_from_another_venue' }],
      }),
    ).rejects.toThrow(/does not exist in this venue/);

    expect(tx.suiteBeoOrder.create).not.toHaveBeenCalled();
  });

  it('rejects an empty import', async () => {
    const { service } = buildService();
    await expect(
      service.commit('ven_1', 'evt_1', { profileId: 'prof_1' }, { documentTitle: 'Doc', rows: [] }),
    ).rejects.toThrow(/no BEO rows/);
  });

  it('writes an audit log naming the document and its size', async () => {
    const { service, tx } = buildService();

    await service.commit('ven_1', 'evt_1', { profileId: 'prof_1' }, { documentTitle: 'Game 1', rows: [row] });

    expect(tx.eventAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'beo_document_imported',
          metadata: { documentTitle: 'Game 1', suiteCount: 1 },
        }),
      }),
    );
  });
});
