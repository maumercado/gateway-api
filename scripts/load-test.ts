/**
 * Simple load test script to generate traffic for metrics visualization
 *
 * Usage:
 *   pnpm tsx scripts/load-test.ts
 *   pnpm tsx scripts/load-test.ts --requests 500 --concurrency 20
 */

const API_KEY = process.env.API_KEY ?? 'test-api-key-12345';
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

interface Options {
  requests: number;
  concurrency: number;
  delayMs: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    requests: 100,
    concurrency: 10,
    delayMs: 50,
  };

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = parseInt(args[i + 1] ?? '', 10);

    if (flag === '--requests' && !isNaN(value)) options.requests = value;
    if (flag === '--concurrency' && !isNaN(value)) options.concurrency = value;
    if (flag === '--delay' && !isNaN(value)) options.delayMs = value;
  }

  return options;
}

const endpoints = [
  { method: 'GET', path: '/test/get' },
  { method: 'GET', path: '/test/headers' },
  { method: 'GET', path: '/test/ip' },
  { method: 'POST', path: '/test/post' },
  { method: 'GET', path: '/test/status/200' },
  { method: 'GET', path: '/test/status/201' },
  { method: 'GET', path: '/test/status/400' },  // 4xx error
  { method: 'GET', path: '/test/status/500' },  // 5xx error (triggers circuit breaker)
  { method: 'GET', path: '/nonexistent' },      // 404 - no route
];

interface Stats {
  total: number;
  success: number;
  errors: Record<number, number>;
  latencies: number[];
}

async function makeRequest(
  method: string,
  path: string,
  stats: Stats
): Promise<void> {
  const start = performance.now();

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify({ test: true, timestamp: Date.now() }) : undefined,
    });

    const latency = performance.now() - start;
    stats.latencies.push(latency);
    stats.total++;

    if (response.ok) {
      stats.success++;
    } else {
      stats.errors[response.status] = (stats.errors[response.status] ?? 0) + 1;
    }
  } catch (error) {
    stats.total++;
    stats.errors[0] = (stats.errors[0] ?? 0) + 1; // 0 = connection error
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)] ?? 0;
}

async function runLoadTest(options: Options): Promise<void> {
  console.log('🚀 Load Test Configuration:');
  console.log(`   Base URL: ${BASE_URL}`);
  console.log(`   API Key: ${API_KEY.slice(0, 10)}...`);
  console.log(`   Total Requests: ${options.requests}`);
  console.log(`   Concurrency: ${options.concurrency}`);
  console.log(`   Delay between batches: ${options.delayMs}ms`);
  console.log('');

  const stats: Stats = {
    total: 0,
    success: 0,
    errors: {},
    latencies: [],
  };

  const startTime = performance.now();
  let completed = 0;

  // Process requests in batches
  while (completed < options.requests) {
    const batchSize = Math.min(options.concurrency, options.requests - completed);
    const batch: Promise<void>[] = [];

    for (let i = 0; i < batchSize; i++) {
      const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)]!;
      batch.push(makeRequest(endpoint.method, endpoint.path, stats));
    }

    await Promise.all(batch);
    completed += batchSize;

    // Progress indicator
    const progress = Math.round((completed / options.requests) * 100);
    process.stdout.write(`\r   Progress: ${completed}/${options.requests} (${progress}%)`);

    if (options.delayMs > 0 && completed < options.requests) {
      await sleep(options.delayMs);
    }
  }

  const totalTime = (performance.now() - startTime) / 1000;
  console.log('\n');

  // Print results
  console.log('📊 Results:');
  console.log(`   Total Requests: ${stats.total}`);
  console.log(`   Successful (2xx): ${stats.success}`);
  console.log(`   Total Time: ${totalTime.toFixed(2)}s`);
  console.log(`   Requests/sec: ${(stats.total / totalTime).toFixed(2)}`);
  console.log('');

  if (Object.keys(stats.errors).length > 0) {
    console.log('   Errors by Status Code:');
    for (const [code, count] of Object.entries(stats.errors).sort()) {
      const label = code === '0' ? 'Connection Error' : `HTTP ${code}`;
      console.log(`     ${label}: ${count}`);
    }
    console.log('');
  }

  if (stats.latencies.length > 0) {
    console.log('   Latency (ms):');
    console.log(`     Min: ${Math.min(...stats.latencies).toFixed(2)}`);
    console.log(`     Max: ${Math.max(...stats.latencies).toFixed(2)}`);
    console.log(`     Avg: ${(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length).toFixed(2)}`);
    console.log(`     P50: ${percentile(stats.latencies, 50).toFixed(2)}`);
    console.log(`     P95: ${percentile(stats.latencies, 95).toFixed(2)}`);
    console.log(`     P99: ${percentile(stats.latencies, 99).toFixed(2)}`);
  }

  console.log('');
  console.log('✅ Done! Check Grafana at http://localhost:3001');
}

// Run
const options = parseArgs();
runLoadTest(options).catch(console.error);
