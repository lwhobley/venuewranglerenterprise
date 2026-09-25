import { randomUUID, createHash } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import { metrics } from '@opentelemetry/api';
import type { NextFunction, Request, Response } from 'express';

const meter = metrics.getMeter('venue-wrangler-api');
const requestCount = meter.createCounter('http.server.request.count', { description: 'Completed HTTP requests' });
const requestDuration = meter.createHistogram('http.server.request.duration', { unit: 'ms', description: 'HTTP request duration' });
const requestIdPattern = /^[A-Za-z0-9._-]{1,80}$/;

export function correlationId(header: string | undefined): string {
  return header && requestIdPattern.test(header) ? header : randomUUID();
}

function routeTemplate(req: Request): string {
  const path = req.route?.path;
  if (typeof path === 'string') return `${req.baseUrl}${path}` || '/';
  if (Array.isArray(path)) return `${req.baseUrl}${path[0]}` || '/';
  return '/unmatched';
}

@Injectable()
export class RequestObservabilityMiddleware implements NestMiddleware {
  use(req: Request & { identity?: { tenantId?: string } }, res: Response, next: NextFunction): void {
    const id = correlationId(req.header('x-request-id'));
    const started = performance.now();
    res.setHeader('x-request-id', id);
    res.on('finish', () => {
      const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
      const route = routeTemplate(req);
      const method = req.method.toUpperCase();
      const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
      const attributes = { 'http.request.method': method, 'http.route': route, 'http.response.status_class': statusClass };
      requestCount.add(1, attributes);
      requestDuration.record(elapsedMs, attributes);

      const tenantHash = req.identity?.tenantId
        ? createHash('sha256').update(req.identity.tenantId).digest('hex').slice(0, 16)
        : undefined;
      process.stdout.write(`${JSON.stringify({
        severity: res.statusCode >= 500 ? 'ERROR' : 'INFO',
        message: 'http_request_completed',
        requestId: id,
        method,
        route,
        statusCode: res.statusCode,
        statusClass,
        durationMs: elapsedMs,
        ...(tenantHash ? { tenantHash } : {}),
      })}\n`);
    });
    next();
  }
}
