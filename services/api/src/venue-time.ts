const localPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const absolutePattern = /(?:Z|[+-]\d{2}:\d{2})$/i;

export function isAbsoluteInstant(value: string): boolean {
  return absolutePattern.test(value) && Number.isFinite(new Date(value).getTime());
}

export function formatVenueLocal(instant: Date, timeZone: string): string {
  const parts = zoneParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function venueLocalToUtc(local: string, timeZone: string): Date {
  const match = localPattern.exec(local);
  if (!match) throw new Error('Event start must be a venue-local time like 2026-09-26T19:00.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error('Event start must be a venue-local time like 2026-09-26T19:00.');
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set<number>();
  for (let hours = -14; hours <= 14; hours += 1) {
    offsets.add(zoneOffsetMs(new Date(utcGuess + hours * 3_600_000), timeZone));
  }
  const matches = new Set<number>();
  for (const offset of offsets) {
    const candidate = new Date(utcGuess - offset);
    if (formatVenueLocal(candidate, timeZone) === local) matches.add(candidate.getTime());
  }
  if (matches.size > 1) {
    throw new Error('That time occurs twice in the venue time zone. Choose a time outside the daylight-saving overlap.');
  }
  if (matches.size === 0) throw new Error('That time does not exist in the venue time zone.');
  return new Date([...matches][0]);
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - instant.getTime();
}

function zoneParts(instant: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const map = Object.fromEntries(formatted.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === '24' ? '00' : map.hour,
    minute: map.minute,
    second: map.second,
  };
}
