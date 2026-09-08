import type { CanonicalBeoInput } from './canonical-beo.types';
import { parseGenericJsonPayload } from './generic-json';

export interface UploadExtractionResult {
  beo: CanonicalBeoInput;
  confidence: 'high' | 'weak';
  rawText?: string;
}

/**
 * Extracts structured fields from uploaded file buffer.
 * If extraction cannot confidently determine space or start/end times,
 * marks confidence as 'weak' so the BEO lands in needs_review queue.
 * Never invents demo data or placeholder attendee numbers.
 */
export function extractFromUploadedDocument(
  fileName: string,
  mimeType: string,
  buffer: Buffer,
): UploadExtractionResult {
  const fileExt = fileName.split('.').pop()?.toLowerCase() ?? '';

  // 1. If JSON file
  if (mimeType.includes('json') || fileExt === 'json') {
    try {
      const text = buffer.toString('utf-8');
      const parsed = JSON.parse(text);
      const beo = parseGenericJsonPayload(parsed);
      beo.externalSource = 'upload-json';
      const hasRequired = Boolean(beo.eventName && (beo.spaceId || beo.venueSpace) && beo.serviceStartAt && beo.serviceEndAt);
      return {
        beo: {
          ...beo,
          status: hasRequired ? (beo.status ?? 'confirmed') : 'needs_review',
        },
        confidence: hasRequired ? 'high' : 'weak',
        rawText: text.slice(0, 5000),
      };
    } catch {
      // Fall through to text extraction
    }
  }

  // 2. Text / CSV extraction
  const rawText = buffer.toString('utf-8');
  const externalId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (fileExt === 'csv' || mimeType.includes('csv')) {
    return extractFromCsv(rawText, externalId);
  }

  // 3. Unstructured text (from PDF / text / DOCX extraction)
  return extractFromText(rawText, externalId, fileName);
}

function extractFromCsv(csvText: string, externalId: string): UploadExtractionResult {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) {
    return {
      beo: {
        externalSource: 'upload-csv',
        externalId,
        eventName: 'Uploaded CSV BEO',
        status: 'needs_review',
        sourcePayload: { rawText: csvText },
      },
      confidence: 'weak',
      rawText: csvText,
    };
  }

  const header = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const firstRow = lines[1].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));

  const getCol = (names: string[]) => {
    const idx = header.findIndex((h) => names.some((n) => h.includes(n)));
    return idx >= 0 && firstRow[idx] ? firstRow[idx] : null;
  };

  const eventName = getCol(['event', 'title', 'name']) ?? 'Uploaded Event';
  const serviceDate = getCol(['date', 'servicedate'])?.slice(0, 10) ?? null;
  const venueSpace = getCol(['space', 'room', 'location', 'suite']);
  const guestsRaw = getCol(['guest', 'attendance', 'count']);
  const guestCount = guestsRaw && !isNaN(Number(guestsRaw)) ? Number(guestsRaw) : null;
  const startTimeRaw = getCol(['start', 'starttime']);
  const endTimeRaw = getCol(['end', 'endtime']);

  const serviceStartAt = startTimeRaw && serviceDate ? new Date(`${serviceDate}T${startTimeRaw}`) : (startTimeRaw ? new Date(startTimeRaw) : null);
  const serviceEndAt = endTimeRaw && serviceDate ? new Date(`${serviceDate}T${endTimeRaw}`) : (endTimeRaw ? new Date(endTimeRaw) : null);

  const hasRequired = Boolean(venueSpace && serviceStartAt && serviceEndAt && !isNaN(serviceStartAt.getTime()) && !isNaN(serviceEndAt.getTime()));

  return {
    beo: {
      externalSource: 'upload-csv',
      externalId,
      eventName,
      serviceDate,
      venueSpace,
      guestCount,
      serviceStartAt: hasRequired ? serviceStartAt : null,
      serviceEndAt: hasRequired ? serviceEndAt : null,
      status: hasRequired ? 'confirmed' : 'needs_review',
      sourcePayload: { header, sample: firstRow },
    },
    confidence: hasRequired ? 'high' : 'weak',
    rawText: csvText,
  };
}

function extractFromText(text: string, externalId: string, fileName: string): UploadExtractionResult {
  // Regex search for fields
  const eventMatch = text.match(/(?:Event|Function|Title|Event Name)\s*[:=-]\s*([^\r\n]+)/i);
  const dateMatch = text.match(/(?:Date|Service Date)\s*[:=-]\s*(\d{4}-\d{2}-\d{2}|\w+ \d{1,2},? \d{4})/i);
  const spaceMatch = text.match(/(?:Room|Space|Location|Venue Space|Suite)\s*[:=-]\s*([^\r\n]+)/i);
  const guestMatch = text.match(/(?:Guests|Attendance|Guest Count|Pax)\s*[:=-]\s*(\d+)/i);
  const startMatch = text.match(/(?:Start|Starts At|Service Start)\s*[:=-]\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}T[^\r\n]+)/i);
  const endMatch = text.match(/(?:End|Ends At|Service End)\s*[:=-]\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{4}-\d{2}-\d{2}T[^\r\n]+)/i);

  const eventName = eventMatch ? eventMatch[1].trim() : fileName.replace(/\.[^/.]+$/, '');
  const venueSpace = spaceMatch ? spaceMatch[1].trim() : null;
  const guestCount = guestMatch ? parseInt(guestMatch[1], 10) : null;

  let serviceDate: string | null = null;
  if (dateMatch) {
    const parsedDate = new Date(dateMatch[1]);
    if (!isNaN(parsedDate.getTime())) {
      serviceDate = parsedDate.toISOString().slice(0, 10);
    }
  }

  let serviceStartAt: Date | null = null;
  let serviceEndAt: Date | null = null;

  if (startMatch && serviceDate) {
    const s = new Date(`${serviceDate} ${startMatch[1]}`);
    if (!isNaN(s.getTime())) serviceStartAt = s;
  }
  if (endMatch && serviceDate) {
    const e = new Date(`${serviceDate} ${endMatch[1]}`);
    if (!isNaN(e.getTime())) serviceEndAt = e;
  }

  // If space or times are missing, do not invent them! Fail open into 'needs_review'
  const hasRequired = Boolean(venueSpace && serviceStartAt && serviceEndAt);

  return {
    beo: {
      externalSource: 'upload-document',
      externalId,
      eventName,
      serviceDate,
      venueSpace,
      guestCount,
      serviceStartAt,
      serviceEndAt,
      status: hasRequired ? 'confirmed' : 'needs_review',
      internalNotes: text.slice(0, 2000),
      sourcePayload: { rawTextLength: text.length, fileName },
    },
    confidence: hasRequired ? 'high' : 'weak',
    rawText: text.slice(0, 5000),
  };
}
