import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
if (endpoint) {
  const base = endpoint.replace(/\/$/, '');
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'venue-wrangler-api',
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
      exportIntervalMillis: 60_000,
    }),
    instrumentations: [
      new HttpInstrumentation({
        requestHook: (span, request) => {
          // Never export query strings: auth codes and integration parameters can appear there.
          const rawUrl = (request as { url?: unknown; path?: unknown }).url
            ?? (request as { path?: unknown }).path;
          const path = typeof rawUrl === 'string' ? rawUrl.split('?')[0] || '/' : '/';
          span.setAttribute('url.full', path);
          span.setAttribute('http.url', path);
          span.setAttribute('http.target', path);
        },
      }),
      new ExpressInstrumentation(),
    ],
  });
  void sdk.start();
  const shutdown = () => { void sdk.shutdown(); };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
