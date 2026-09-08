import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BeoIngestService } from './beo-ingest.service';
import { parseGenericJsonPayload } from './adapters/generic-json';
import { parseUngerboeckPayload } from './adapters/ungerboeck';
import { extractFromUploadedDocument } from './adapters/upload-parser';

describe('BeoIngestService & Hub Normalizers', () => {
  let service: BeoIngestService;
  let mockPrisma: any;
  let mockEventBeoReportService: any;

  beforeEach(() => {
    mockPrisma = {
      venue: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'venue-1',
          organizationId: 'org-1',
          timezone: 'America/Chicago',
        }),
      },
      crmBeo: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      facilityZone: {
        findFirst: vi.fn(),
      },
      venueEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'evt-created-1' }),
      },
      $transaction: vi.fn(async (cb) => {
        if (typeof cb === 'function') {
          return cb(mockPrisma);
        }
        return cb;
      }),
    };

    mockEventBeoReportService = {
      publish: vi.fn().mockResolvedValue({ version: 1 }),
    };

    service = new BeoIngestService(mockPrisma as any, mockEventBeoReportService as any);
  });

  describe('Idempotency and Duplicate Ingest', () => {
    it('creates new canonical BEO when record does not exist', async () => {
      mockPrisma.crmBeo.findUnique.mockResolvedValue(null);
      mockPrisma.crmBeo.create.mockImplementation((args: any) => ({
        id: 'beo-1',
        ...args.data,
      }));

      const start = new Date(Date.now() + 86400000);
      const end = new Date(start.getTime() + 4 * 3600 * 1000);

      const result = await service.ingestCanonicalBeo('venue-1', {
        externalSource: 'ungerboeck',
        externalId: 'UB-9901',
        eventName: 'Governor Dinner',
        venueSpace: 'Grand Ballroom',
        serviceStartAt: start,
        serviceEndAt: end,
        guestCount: 250,
      });

      expect(result.id).toBe('beo-1');
      expect(result.isDuplicate).toBe(false);
      expect(result.status).toBe('confirmed');
      expect(mockPrisma.crmBeo.create).toHaveBeenCalledOnce();
    });

    it('returns existing BEO on duplicate ingest when sourceUpdatedAt is older or equal', async () => {
      const existingDate = new Date('2026-09-07T12:00:00Z');
      mockPrisma.crmBeo.findUnique.mockResolvedValue({
        id: 'beo-existing-1',
        status: 'confirmed',
        updatedAt: existingDate,
        sourceUpdatedAt: existingDate,
        eventId: 'evt-1',
        layoutJson: null,
      });

      const result = await service.ingestCanonicalBeo('venue-1', {
        externalSource: 'ungerboeck',
        externalId: 'UB-9901',
        eventName: 'Governor Dinner',
        sourceUpdatedAt: existingDate,
      });

      expect(result.id).toBe('beo-existing-1');
      expect(result.isDuplicate).toBe(true);
      expect(mockPrisma.crmBeo.create).not.toHaveBeenCalled();
      expect(mockPrisma.crmBeo.update).not.toHaveBeenCalled();
    });
  });

  describe('Validation & Needs Review Handling', () => {
    it('flags needs_review when space is missing, without inventing default data', async () => {
      mockPrisma.crmBeo.findUnique.mockResolvedValue(null);
      mockPrisma.crmBeo.create.mockImplementation((args: any) => ({
        id: 'beo-review-1',
        ...args.data,
      }));

      const start = new Date(Date.now() + 86400000);
      const end = new Date(start.getTime() + 4 * 3600 * 1000);

      const result = await service.ingestCanonicalBeo('venue-1', {
        externalSource: 'generic-json',
        externalId: 'EXT-100',
        eventName: 'Executive Briefing',
        // Space missing!
        venueSpace: '',
        spaceId: '',
        serviceStartAt: start,
        serviceEndAt: end,
      });

      expect(result.needsReview).toBe(true);
      expect(result.status).toBe('needs_review');
    });

    it('flags needs_review when start/end times are missing', async () => {
      mockPrisma.crmBeo.findUnique.mockResolvedValue(null);
      mockPrisma.crmBeo.create.mockImplementation((args: any) => ({
        id: 'beo-review-2',
        ...args.data,
      }));

      const result = await service.ingestCanonicalBeo('venue-1', {
        externalSource: 'generic-json',
        externalId: 'EXT-101',
        eventName: 'Board Meeting',
        venueSpace: 'Boardroom A',
        // Times missing!
        serviceStartAt: null,
        serviceEndAt: null,
      });

      expect(result.needsReview).toBe(true);
      expect(result.status).toBe('needs_review');
    });
  });

  describe('Adapters Normalization', () => {
    it('normalizes Ungerboeck payload into canonical slices', () => {
      const payload = {
        FunctionID: 'UB-FUNCTION-55',
        FunctionDescription: 'Annual Gala',
        SpaceDescription: 'Grand Pavilion',
        StartDate: '2026-10-15',
        StartTime: '2026-10-15T18:00:00Z',
        EndTime: '2026-10-15T23:00:00Z',
        GuaranteedAttendance: 400,
        Orders: [
          { Description: 'Filet Mignon', Quantity: 400, Department: 'Food & Culinary' },
          { Description: 'Premium Champagne', Quantity: 80, Department: 'Bar & Beverage' },
        ],
        CulinaryNotes: 'Gluten-free alternatives on table 4',
        SetupNotes: 'Rounds of 10 with dance floor',
      };

      const canonical = parseUngerboeckPayload(payload);
      expect(canonical.externalSource).toBe('ungerboeck');
      expect(canonical.externalId).toBe('UB-FUNCTION-55');
      expect(canonical.eventName).toBe('Annual Gala');
      expect(canonical.venueSpace).toBe('Grand Pavilion');
      expect(canonical.guestCount).toBe(400);
      expect(canonical.departmentSlices?.kitchen?.menuItems).toHaveLength(1);
      expect(canonical.departmentSlices?.kitchen?.notes).toBe('Gluten-free alternatives on table 4');
      expect(canonical.departmentSlices?.bars?.specialtyCocktails).toHaveLength(1);
      expect(canonical.departmentSlices?.banquetFloor?.notes).toBe('Rounds of 10 with dance floor');
    });

    it('normalizes Generic JSON payload into canonical BEO', () => {
      const payload = {
        id: 'GJ-900',
        title: 'Quarterly Town Hall',
        space: 'Auditorium',
        serviceDate: '2026-11-01',
        startTime: '2026-11-01T14:00:00Z',
        endTime: '2026-11-01T17:00:00Z',
        guestCount: 150,
        kitchen: {
          notes: 'Coffee and pastry station',
        },
      };

      const canonical = parseGenericJsonPayload(payload);
      expect(canonical.externalSource).toBe('generic-json');
      expect(canonical.externalId).toBe('GJ-900');
      expect(canonical.eventName).toBe('Quarterly Town Hall');
      expect(canonical.venueSpace).toBe('Auditorium');
      expect(canonical.guestCount).toBe(150);
      expect(canonical.departmentSlices?.kitchen?.notes).toBe('Coffee and pastry station');
    });

    it('extracts structured fields from uploaded document buffer with weak confidence on missing times', () => {
      const text = 'Event Name: Charity Auction\nRoom: East Terrace\nGuests: 85';
      const buffer = Buffer.from(text, 'utf-8');

      const extracted = extractFromUploadedDocument('auction.txt', 'text/plain', buffer);
      expect(extracted.beo.eventName).toBe('Charity Auction');
      expect(extracted.beo.venueSpace).toBe('East Terrace');
      expect(extracted.beo.guestCount).toBe(85);
      // Missing start/end times -> weak confidence & needs_review!
      expect(extracted.confidence).toBe('weak');
      expect(extracted.beo.status).toBe('needs_review');
    });
  });

  describe('36-Hour Operational Window Auto-Publish', () => {
    it('triggers event BEO report publish when associated event is inside 36 hours', async () => {
      const now = new Date();
      const eventStart = new Date(now.getTime() + 12 * 3600 * 1000); // 12 hours away
      const eventEnd = new Date(eventStart.getTime() + 4 * 3600 * 1000);

      mockPrisma.crmBeo.findUnique.mockResolvedValue(null);
      mockPrisma.crmBeo.create.mockImplementation((args: any) => ({
        id: 'beo-auto-pub',
        ...args.data,
      }));

      mockPrisma.venueEvent.findFirst.mockResolvedValue({
        id: 'evt-imminent-1',
        startsAt: eventStart,
      });

      await service.ingestCanonicalBeo('venue-1', {
        externalSource: 'generic-json',
        externalId: 'AUTO-1',
        eventName: 'Tonight Concert Catering',
        venueSpace: 'Club Level Lounge',
        eventId: 'evt-imminent-1',
        serviceStartAt: eventStart,
        serviceEndAt: eventEnd,
      });

      expect(mockEventBeoReportService.publish).toHaveBeenCalledWith(
        'venue-1',
        'evt-imminent-1',
        expect.any(Object),
        'scheduled'
      );
    });
  });
});
