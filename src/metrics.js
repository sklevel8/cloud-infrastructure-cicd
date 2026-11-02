/**
 * Prometheus metrics.
 *
 * The registry is exposed on /metrics for scraping. It is also what makes the
 * ECS/ALB alarms meaningful: request rate, error rate and latency all come
 * from here rather than from guesswork.
 */

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

export function createMetrics({ service = 'api', version = '0.0.0' } = {}) {
  const registry = new Registry();
  registry.setDefaultLabels({ service, version });
  collectDefaultMetrics({ register: registry });

  const httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });

  const ready = new Gauge({
    name: 'app_ready',
    help: '1 when the instance is ready to serve traffic, 0 while draining or degraded',
    registers: [registry],
  });

  return { registry, httpRequestDuration, httpRequests, ready };
}
