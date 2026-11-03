/**
 * VisionGuide AI - High-Throughput Load Testing Engine
 * Manages 100 concurrent virtual user workers, measures nanosecond-precision
 * latencies, computes RPS throughput, and produces percentile distributions.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { HEADERS } = require('../config/loadTestConfig');

// Persistent keep-alive agents for high-frequency concurrent HTTP reuse
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 200 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 200 });

class LoadEngine {
  /**
   * Executes a single HTTP request with microsecond timing
   */
  static async request(method, urlStr, body = null, customHeaders = {}) {
    const url = new URL(urlStr);
    const isHttps = url.protocol === 'https:';
    const agent = isHttps ? httpsAgent : httpAgent;
    const client = isHttps ? https : http;

    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;

    const reqHeaders = {
      ...HEADERS,
      ...customHeaders,
    };

    if (payload) {
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const options = {
      method: method.toUpperCase(),
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + (url.search || ''),
      headers: reqHeaders,
      agent,
      timeout: 10000,
    };

    return new Promise((resolve) => {
      const t0 = process.hrtime.bigint();
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          const t1 = process.hrtime.bigint();
          const durationMs = Number(t1 - t0) / 1_000_000;
          resolve({
            status: res.statusCode,
            durationMs: parseFloat(durationMs.toFixed(2)),
            headers: res.headers,
            data,
            success: res.statusCode >= 200 && res.statusCode < 400,
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const t1 = process.hrtime.bigint();
        const durationMs = Number(t1 - t0) / 1_000_000;
        resolve({
          status: 408,
          durationMs: parseFloat(durationMs.toFixed(2)),
          error: 'Request Timeout',
          success: false,
        });
      });

      req.on('error', (err) => {
        const t1 = process.hrtime.bigint();
        const durationMs = Number(t1 - t0) / 1_000_000;
        resolve({
          status: 500,
          durationMs: parseFloat(durationMs.toFixed(2)),
          error: err.message,
          success: false,
        });
      });

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Executes a concurrent batch across N virtual users
   */
  static async runConcurrentBatch({
    virtualUsers = 100,
    totalRequests = 100,
    method = 'GET',
    url,
    body = null,
    headers = {},
  }) {
    const latencies = [];
    let successCount = 0;
    let failCount = 0;
    const statusCodes = {};

    const tStart = Date.now();

    // Distribute totalRequests across concurrent virtual users
    let remaining = totalRequests;
    while (remaining > 0) {
      const batchSize = Math.min(virtualUsers, remaining);
      remaining -= batchSize;

      const promises = Array.from({ length: batchSize }, () =>
        this.request(method, url, body, headers)
      );

      const results = await Promise.all(promises);
      for (const res of results) {
        latencies.push(res.durationMs);
        statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;
        if (res.success) {
          successCount++;
        } else {
          failCount++;
        }
      }
    }

    const tTotal = Math.max(1, Date.now() - tStart);
    return this.calculateStats(latencies, tTotal, failCount, successCount, statusCodes);
  }

  /**
   * Runs a sustained continuous load test for specified duration (e.g. 60 seconds)
   * with virtual users generating continuous requests.
   */
  static async runSustainedLoad({
    virtualUsers = 100,
    durationSeconds = 60,
    endpoints = [],
    progressCallback = null,
  }) {
    const latencies = [];
    let successCount = 0;
    let failCount = 0;
    const statusCodes = {};
    const endpointMetrics = {};

    endpoints.forEach(ep => {
      endpointMetrics[ep.path] = { requests: 0, latencies: [], successes: 0, failures: 0 };
    });

    const tStart = Date.now();
    const endTime = tStart + (durationSeconds * 1000);
    let active = true;

    // Worker pool for virtual users
    const userWorker = async (userId) => {
      let idx = userId % endpoints.length;
      while (active && Date.now() < endTime) {
        const ep = endpoints[idx % endpoints.length];
        idx++;

        const res = await this.request(ep.method || 'GET', ep.url, ep.body || null, ep.headers || {});
        latencies.push(res.durationMs);
        statusCodes[res.status] = (statusCodes[res.status] || 0) + 1;

        if (res.success) {
          successCount++;
        } else {
          failCount++;
        }

        const m = endpointMetrics[ep.path];
        if (m) {
          m.requests++;
          m.latencies.push(res.durationMs);
          if (res.success) m.successes++; else m.failures++;
        }

        // Tiny cooperative yielding to allow event loop scheduling
        if (userId % 10 === 0) {
          await new Promise(r => setImmediate(r));
        }
      }
    };

    // Monitor timer
    const interval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - tStart) / 1000);
      const currentRps = (latencies.length / Math.max(1, elapsedSec)).toFixed(1);
      if (progressCallback) {
        progressCallback({
          elapsedSec,
          durationSeconds,
          totalRequests: latencies.length,
          currentRps,
        });
      }
    }, 1000);

    // Launch 100 virtual users
    const workers = Array.from({ length: virtualUsers }, (_, i) => userWorker(i));
    await Promise.all(workers);
    active = false;
    clearInterval(interval);

    const tTotal = Math.max(1, Date.now() - tStart);
    const overallStats = this.calculateStats(latencies, tTotal, failCount, successCount, statusCodes);

    // Calculate per-endpoint statistics
    const perEndpointStats = {};
    for (const [path, m] of Object.entries(endpointMetrics)) {
      perEndpointStats[path] = this.calculateStats(m.latencies, tTotal, m.failures, m.successes, {});
    }

    return {
      ...overallStats,
      virtualUsers,
      durationSeconds: parseFloat((tTotal / 1000).toFixed(1)),
      endpointBreakdown: perEndpointStats,
    };
  }

  /**
   * Helper to compute percentiles, averages, min, max, and throughput
   */
  static calculateStats(latencies, durationMs, failCount, successCount, statusCodes = {}) {
    if (latencies.length === 0) {
      return {
        totalRequests: 0,
        successCount: 0,
        failCount: 0,
        durationMs,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p95: 0,
        p99: 0,
        rps: 0,
        errorRate: 0,
        statusCodes,
      };
    }

    const sorted = [...latencies].sort((a, b) => a - b);
    const min = parseFloat(sorted[0].toFixed(1));
    const max = parseFloat(sorted[sorted.length - 1].toFixed(1));
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const avg = parseFloat((sum / sorted.length).toFixed(1));

    const p50 = parseFloat(sorted[Math.floor(sorted.length * 0.50)].toFixed(1));
    const p90 = parseFloat(sorted[Math.floor(sorted.length * 0.90)].toFixed(1));
    const p95 = parseFloat(sorted[Math.floor(sorted.length * 0.95)].toFixed(1));
    const p99 = parseFloat(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))].toFixed(1));

    const durationSec = durationMs / 1000;
    const rps = parseFloat((sorted.length / durationSec).toFixed(1));
    const errorRate = parseFloat(((failCount / sorted.length) * 100).toFixed(2));

    return {
      totalRequests: sorted.length,
      successCount,
      failCount,
      durationMs,
      min,
      max,
      avg,
      p50,
      p90,
      p95,
      p99,
      rps,
      errorRate,
      statusCodes,
    };
  }
}

module.exports = LoadEngine;
