/**
 * VisionGuide AI - Baseline & Load Testing Configuration
 * 
 * Target Profile:
 * - 100 Virtual Users (VU)
 * - 1 Minute (60s) continuous execution
 * - Thousands of requests dispatched
 * - Metrics: RPS (req/sec), Average / Min / Max Response Times, P50 / P90 / P95 / P99
 */

module.exports = {
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:5000',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  
  // Baseline Load Parameters
  VIRTUAL_USERS: 100,
  DURATION_SECONDS: 60,
  TARGET_RPS: 120, // Expected ~120 requests/sec

  // Response Time SLAs (as defined by user)
  SLA: {
    AVG_RESPONSE_TIME_MS: 250,   // Target: ~250ms
    MIN_RESPONSE_TIME_MS: 50,    // Target: ~50ms
    MAX_RESPONSE_TIME_MS: 1500,  // Target: <= 1.5s
    P95_RESPONSE_TIME_MS: 500,   // 95% under 500ms
    P99_RESPONSE_TIME_MS: 1000,  // 99% under 1000ms
    MAX_ERROR_RATE: 0.01,        // Max 1% error tolerance (expected 0%)
  },

  // Security & Bypass Headers for Benchmark Testing
  HEADERS: {
    'x-session-token': 'demo',
    'x-api-key': 'vg_2024_k9mPqR7nXs3wLjT',
    'x-load-test': 'vg-benchmark',
    'Content-Type': 'application/json',
    'User-Agent': 'VisionGuideAI-LoadTester/1.0 (100-VU; Node.js)',
  },
};
