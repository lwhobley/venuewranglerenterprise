import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SuiteBeoStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { withTenantTransaction } from '../../prisma/tenant-transaction';
import { callAiJson, resolveAiApiKey, resolveAiModel } from '../../common/ai-json-parse';
import { matchSuite, type SuiteCandidate, type SuiteMatch } from './beo-suite-matching';

/**
 * Bringing BEOs in from the document the caterer actually sends.
 *
 * Two steps on purpose. `parse` reads the upload and proposes rows without
 * writing anything; `commit` takes the rows a manager has reviewed and creates
 * the records. Nothing reaches the database on the strength of a model reading
 * a PDF — a suite that could not be resolved is handed back to be settled by
 * someone, because catering delivered to the wrong suite is worse than a
 * prompt.
 */

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SUITE_ROWS = 200;
const MAX_LINE_ITEMS_PER_SUITE = 100;

/** Gemini reads these directly as inline data; no extraction step is needed. */
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** Leading bytes for each accepted type, so the declared mime type is checked. */
const MAGIC_BYTES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/webp', bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 }, // RIFF....WEBP
  { mime: 'image/heic', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ....ftyp
  { mime: 'image/heif', bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
];

const PROMPT = `Extract every banquet event order (BEO) line from this catering document.
Each entry covers one suite. Times are local to the venue; return them as "HH:MM" 24-hour strings, or null when the document does not state one. Prices are in cents.
Return STRICT JSON matching {"documentTitle":"string","eventName":"string","eventDate":"YYYY-MM-DD or null","notes":"string","suites":[{"suiteLabel":"string","beoNumber":"string or null","hostName":"string","guestCount":number,"serviceStart":"HH:MM or null","serviceEnd":"HH:MM or null","specialInstructions":"string or null","lineItems":[{"code":"string","name":"string","quantity":number,"unitPriceCents":number,"category":"appetizer|entree|dessert|bar|other"}]}]}
suiteLabel must be copied verbatim from the document. Do not invent suites, guests, or items that are not written there.`;

const LINE_ITEM_CATEGORIES = new Set(['appetizer', 'entree', 'dessert', 'bar', 'other']);

export interface ParsedLineItem {
  code: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  category: string;
}

export interface ParsedSuiteRow {
  /** Stable within one parse, so the review screen can address a row. */
  rowId: string;
  /** Exactly as the document wrote it, so a manager can check the mapping. */
  suiteLabel: string;
  beoNumber: string | null;
  hostName: string;
  guestCount: number;
  serviceStart: string | null;
  serviceEnd: string | null;
  specialInstructions: string | null;
  lineItems: ParsedLineItem[];
  totalCents: number;
  match: SuiteMatch | null;
  candidates: SuiteCandidate[];
}

export interface ParsedBeoUpload {
  documentTitle: string;
  eventName: string;
  eventDate: string | null;
  notes: string;
  rows: ParsedSuiteRow[];
  /**
   * Every active suite in the venue, so the review screen can offer a choice
   * for a row the parser matched to nothing at all — those carry no candidates
   * of their own, and a second round trip to fetch them buys nothing.
   */
  venueSuites: SuiteCandidate[];
  matchedCount: number;
  unmatchedCount: number;
  /** True only when every row resolved; `commit` refuses otherwise. */
  readyToCommit: boolean;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed || null;
}

function wholeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

/** "HH:MM" only; anything else is treated as absent rather than guessed at. */
function timeOfDay(value: unknown): string | null {
  const raw = text(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(raw) ? raw : null;
}

export function assertAllowedUpload(data: Buffer, declaredMimeType: string): string {
  if (data.length === 0) throw new BadRequestException('The uploaded file is empty.');
  if (data.length > MAX_UPLOAD_BYTES) throw new BadRequestException('BEO uploads are limited to 10MB.');
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(declaredMimeType)) {
    throw new BadRequestException('Upload a PDF or a photo of the BEO (JPEG, PNG, WebP, HEIC).');
  }
  const matches = MAGIC_BYTES.some((candidate) => {
    const offset = candidate.offset ?? 0;
    if (data.length < offset + candidate.bytes.length) return false;
    return candidate.bytes.every((byte, index) => data[offset + index] === byte);
  });
  if (!matches) {
    throw new BadRequestException('That file is not a readable PDF or image.');
  }
  return declaredMimeType;
}

/**
 * Combines the event's date with a "HH:MM" from the document.
 *
 * The document states a clock time and nothing else, so the date has to come
 * from the event. A service window that ends before it starts has crossed
 * midnight and is rolled to the next day.
 */
export function resolveServiceWindow(
  eventStartsAt: Date,
  start: string | null,
  end: string | null,
): { start: Date; end: Date } {
  const base = new Date(eventStartsAt);
  const at = (value: string | null, fallbackMinutes: number) => {
    const next = new Date(base);
    if (value) {
      const [hours, minutes] = value.split(':').map(Number);
      next.setHours(hours, minutes, 0, 0);
    } else {
      next.setMinutes(next.getMinutes() + fallbackMinutes, 0, 0);
    }
    return next;
  };
  // With no stated window, fall back to the 90 minutes before kickoff, which is
  // when suites are normally served.
  const startAt = at(start, -90);
  let endAt = at(end, -30);
  if (endAt <= startAt) endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
  return { start: startAt, end: endAt };
}

export interface CommitRowInput {
  rowId: string;
  /** Resolved by the manager on review; the commit refuses without it. */
  subVenueId: string;
  beoNumber?: string | null;
  hostName: string;
  guestCount?: number | null;
  serviceStart?: string | null;
  serviceEnd?: string | null;
  specialInstructions?: string | null;
  lineItems: ParsedLineItem[];
}

@Injectable()
export class BeoUploadService {
  constructor(private readonly prisma: PrismaService) {}

  private async suiteCandidates(facilityId: string): Promise<SuiteCandidate[]> {
    const rows = await this.prisma.subVenue.findMany({
      where: { facilityId, active: true },
      select: { id: true, zoneId: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
    return rows;
  }

  /**
   * Reads an uploaded BEO document and proposes rows. Writes nothing.
   */
  async parse(
    venueId: string,
    eventId: string,
    input: { fileBase64: string; mimeType: string },
  ): Promise<ParsedBeoUpload> {
    const event = await this.prisma.venueEvent.findFirst({
      where: { id: eventId, venueId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Stadium event not found.');

    const apiKey = resolveAiApiKey();
    if (!apiKey) throw new BadRequestException('Reading BEO uploads requires GEMINI_API_KEY configuration.');

    const encoded = input.fileBase64.replace(/\s/g, '');
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
      throw new BadRequestException('The uploaded file is not valid base64.');
    }
    const data = Buffer.from(encoded, 'base64');
    const mimeType = assertAllowedUpload(data, input.mimeType);

    const parsed = await callAiJson({
      apiKey,
      model: resolveAiModel(process.env.GEMINI_BEO_MODEL, 'gemini-flash-latest'),
      prompt: PROMPT,
      imageBase64: encoded,
      imageMimeType: mimeType,
      feature: 'beo_upload',
    });

    const candidates = await this.suiteCandidates(venueId);
    return this.normalizeParsedUpload(parsed, candidates);
  }

  /**
   * Shapes whatever the model returned into rows, dropping anything without the
   * fields a BEO needs rather than importing a blank.
   */
  normalizeParsedUpload(parsed: unknown, candidates: SuiteCandidate[]): ParsedBeoUpload {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { suites?: unknown }).suites)) {
      throw new BadRequestException(
        'The BEO could not be read from that file. Try a clearer scan, or a PDF rather than a photo.',
      );
    }
    const raw = parsed as { documentTitle?: unknown; eventName?: unknown; eventDate?: unknown; notes?: unknown; suites: unknown[] };

    const rows: ParsedSuiteRow[] = raw.suites.slice(0, MAX_SUITE_ROWS).flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const suite = entry as Record<string, unknown>;
      const suiteLabel = text(suite.suiteLabel);
      if (!suiteLabel) return [];

      const lineItems: ParsedLineItem[] = Array.isArray(suite.lineItems)
        ? suite.lineItems.slice(0, MAX_LINE_ITEMS_PER_SUITE).flatMap((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
            const row = item as Record<string, unknown>;
            const name = text(row.name);
            if (!name) return [];
            const category = text(row.category).toLowerCase();
            return [
              {
                code: text(row.code),
                name,
                quantity: Math.max(1, wholeNumber(row.quantity, 1)),
                unitPriceCents: wholeNumber(row.unitPriceCents),
                category: LINE_ITEM_CATEGORIES.has(category) ? category : 'other',
              },
            ];
          })
        : [];

      const { match, candidates: rowCandidates } = matchSuite(suiteLabel, candidates);
      return [
        {
          rowId: `row-${index}`,
          suiteLabel,
          beoNumber: optionalText(suite.beoNumber),
          hostName: text(suite.hostName) || suiteLabel,
          guestCount: wholeNumber(suite.guestCount),
          serviceStart: timeOfDay(suite.serviceStart),
          serviceEnd: timeOfDay(suite.serviceEnd),
          specialInstructions: optionalText(suite.specialInstructions),
          lineItems,
          totalCents: lineItems.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0),
          match,
          candidates: rowCandidates,
        },
      ];
    });

    const matchedCount = rows.filter((row) => row.match).length;
    return {
      documentTitle: text(raw.documentTitle) || 'Uploaded BEO',
      eventName: text(raw.eventName),
      eventDate: optionalText(raw.eventDate),
      notes: text(raw.notes),
      rows,
      venueSuites: candidates,
      matchedCount,
      unmatchedCount: rows.length - matchedCount,
      readyToCommit: rows.length > 0 && matchedCount === rows.length,
    };
  }

  /**
   * Creates the records for the reviewed rows: one sales BEO for the document,
   * and one operational suite order per row linked to it.
   */
  async commit(
    venueId: string,
    eventId: string,
    actor: { profileId: string },
    input: { documentTitle: string; rows: CommitRowInput[] },
  ) {
    if (!input.rows.length) throw new BadRequestException('There are no BEO rows to import.');
    if (input.rows.length > MAX_SUITE_ROWS) {
      throw new BadRequestException(`A single upload can import at most ${MAX_SUITE_ROWS} suites.`);
    }

    const unresolved = input.rows.filter((row) => !row.subVenueId?.trim());
    if (unresolved.length) {
      throw new BadRequestException(
        `Assign a suite to every row before importing. ${unresolved.length} still unresolved.`,
      );
    }

    const event = await this.prisma.venueEvent.findFirst({
      where: { id: eventId, venueId },
      select: { id: true, title: true, startsAt: true, expectedGuests: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Stadium event not found.');

    // Every suite must belong to this facility — a caller-supplied id is not
    // trusted just because the parse step proposed one.
    const suites = await this.prisma.subVenue.findMany({
      where: { facilityId: venueId, id: { in: input.rows.map((row) => row.subVenueId) } },
      select: { id: true, zoneId: true, code: true, name: true },
    });
    const suiteById = new Map(suites.map((suite) => [suite.id, suite]));
    const foreign = input.rows.filter((row) => !suiteById.has(row.subVenueId));
    if (foreign.length) {
      throw new BadRequestException('One or more rows name a suite that does not exist in this venue.');
    }

    const documentTitle = text(input.documentTitle) || `${event.title} BEOs`;

    return withTenantTransaction(
      this.prisma,
      async (tx) => {
        // The sales-side record for the document as a whole.
        const salesBeo = await tx.crmBeo.create({
          data: {
            venueId,
            eventName: documentTitle,
            eventDate: event.startsAt,
            guestCount: input.rows.reduce((total, row) => total + (row.guestCount ?? 0), 0),
            status: 'confirmed',
            internalNotes: `Imported from an uploaded BEO document for ${event.title}.`,
          },
          select: { id: true },
        });

        // Suite numbers must be unique per facility, so they are derived from
        // the sales BEO id rather than from whatever the document happened to
        // print — two uploads of the same document would otherwise collide.
        const created = [];
        for (const [index, row] of input.rows.entries()) {
          const suite = suiteById.get(row.subVenueId)!;
          const window = resolveServiceWindow(event.startsAt, row.serviceStart ?? null, row.serviceEnd ?? null);
          const lineItems = row.lineItems ?? [];
          const order = await tx.suiteBeoOrder.create({
            data: {
              organizationId: event.organizationId,
              facilityId: venueId,
              zoneId: suite.zoneId,
              subVenueId: suite.id,
              eventId: event.id,
              crmBeoId: salesBeo.id,
              beoNumber: `${salesBeo.id.slice(-6).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
              hostName: text(row.hostName) || suite.name,
              guestCount: row.guestCount ?? null,
              deliveryWindowStart: window.start,
              deliveryWindowEnd: window.end,
              specialInstructions: optionalText(row.specialInstructions),
              cateringLineItems: lineItems as unknown as Prisma.InputJsonValue,
              status: SuiteBeoStatus.confirmed_beo,
              totalCents: lineItems.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0),
            },
            select: { id: true, beoNumber: true, subVenueId: true },
          });
          created.push(order);
        }

        await tx.eventAuditLog.create({
          data: {
            organizationId: event.organizationId,
            venueId,
            eventId: event.id,
            actorProfileId: actor.profileId,
            entityType: 'beo_upload',
            entityId: salesBeo.id,
            action: 'beo_document_imported',
            metadata: { documentTitle, suiteCount: created.length },
          },
        });

        return { salesBeoId: salesBeo.id, documentTitle, suiteOrders: created };
      },
      { venueId },
    );
  }
}
