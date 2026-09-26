import { BadRequestException } from '@nestjs/common';

type Selector = { path: string } | { literal: string | number | boolean | null };
export interface IntegrationTransformDefinition {
  externalId: Selector;
  eventType: Selector;
  occurredAt: Selector;
  venueEventId?: Selector;
  externalEventId?: Selector;
  externalVenueId?: Selector;
  payload: Record<string, Selector>;
}

const selectorKeys = new Set(['externalId', 'eventType', 'occurredAt', 'venueEventId', 'externalEventId', 'externalVenueId']);
const pathPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,199}$/;
const safeKey = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;

function selector(input: unknown): Selector {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Each transform selector must be an object.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 1) throw new BadRequestException('A transform selector needs exactly one path or literal.');
  if ('path' in value) {
    if (typeof value.path !== 'string' || !pathPattern.test(value.path) || value.path.split('.').some((part) => !part || ['__proto__', 'constructor', 'prototype'].includes(part))) throw new BadRequestException('Transform paths must use safe dot-separated field names.');
    return { path: value.path };
  }
  if ('literal' in value && (value.literal === null || ['string', 'number', 'boolean'].includes(typeof value.literal))) {
    if (typeof value.literal === 'number' && !Number.isFinite(value.literal)) throw new BadRequestException('Transform literals must be finite.');
    return { literal: value.literal as string | number | boolean | null };
  }
  throw new BadRequestException('A transform selector needs a JSON scalar literal or field path.');
}

export function validateIntegrationTransform(input: unknown): IntegrationTransformDefinition {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Transform definition must be an object.');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > 8192) throw new BadRequestException('Transform definition exceeds 8192 bytes.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'payload' && !selectorKeys.has(key))) throw new BadRequestException('Transform definition has unsupported fields.');
  if (!value.externalId || !value.eventType || !value.occurredAt || (!value.venueEventId && !value.externalEventId)) throw new BadRequestException('Transform must map externalId, eventType, occurredAt, and an event identifier.');
  if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) throw new BadRequestException('Transform payload must map named fields.');
  const fields = Object.entries(value.payload as Record<string, unknown>);
  if (fields.length > 50 || fields.some(([key]) => !safeKey.test(key))) throw new BadRequestException('Transform payload supports at most 50 safe field names.');
  const normalized = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'payload').map(([key, spec]) => [key, selector(spec)])) as unknown as IntegrationTransformDefinition;
  normalized.payload = Object.fromEntries(fields.map(([key, spec]) => [key, selector(spec)]));
  return normalized;
}

function readSelector(input: Record<string, unknown>, spec: Selector): unknown {
  if ('literal' in spec) return spec.literal;
  let current: unknown = input;
  for (const part of spec.path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function transformIntegrationRecord(definition: IntegrationTransformDefinition, raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('Raw integration record must be a JSON object.');
  const record = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of selectorKeys) {
    const spec = definition[key as keyof IntegrationTransformDefinition] as Selector | undefined;
    if (!spec) continue;
    const value = readSelector(record, spec);
    if (value !== undefined) result[key] = value;
  }
  const payload: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(definition.payload)) {
    const value = readSelector(record, spec);
    if (value !== undefined) payload[key] = value;
  }
  result.payload = payload;
  return result;
}
