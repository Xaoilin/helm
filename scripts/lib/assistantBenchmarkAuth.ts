import { createHmac } from 'node:crypto';

export function benchmarkAuthorization(secret: string, deploymentSha: string, now = Date.now()): string {
  if (secret.length < 32 || !/^[a-f0-9]{40}$/u.test(deploymentSha)) {
    throw new Error('Hosted benchmark requires ASSISTANT_BENCHMARK_SECRET and an exact ASSISTANT_DEPLOY_SHA.');
  }
  const expires = Math.floor(now / 1000) + 240;
  const signature = createHmac('sha256', secret).update(`assistant-benchmark:${deploymentSha}:${expires}`).digest('hex');
  return `Bearer benchmark.${deploymentSha}.${expires}.${signature}`;
}
