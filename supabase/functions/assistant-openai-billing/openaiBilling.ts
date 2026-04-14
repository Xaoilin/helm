export interface OpenAIProjectCostBucket {
  startTime: number;
  endTime: number;
  amount: {
    currency: string;
    value: number;
  };
}

export interface OpenAIProjectUsageResult {
  model: string;
  serviceTier: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalRequests: number;
}

export interface OpenAIProjectUsageBucket {
  startTime: number;
  endTime: number;
  results: OpenAIProjectUsageResult[];
}

export function buildOpenAIOrganizationUrl(
  path: string,
  params: Record<string, number | string | string[]>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach(entry => searchParams.append(key, entry));
      continue;
    }

    searchParams.set(key, String(value));
  }

  return `https://api.openai.com${path}?${searchParams.toString()}`;
}

export function buildLastSevenUtcDayRange(now: Date = new Date()): { startTime: number; endTime: number } {
  const currentUtcDayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ) / 1000;

  return {
    startTime: currentUtcDayStart - (6 * 86_400),
    endTime: currentUtcDayStart + 86_400,
  };
}

export function extractCostBuckets(data: unknown): OpenAIProjectCostBucket[] {
  if (typeof data !== 'object' || data === null || !('data' in data) || !Array.isArray(data.data)) {
    return [];
  }

  return data.data
    .map(bucket => {
      if (typeof bucket !== 'object' || bucket === null) return null;

      const startTime = 'start_time' in bucket && typeof bucket.start_time === 'number' ? bucket.start_time : null;
      const endTime = 'end_time' in bucket && typeof bucket.end_time === 'number' ? bucket.end_time : null;
      const results = 'results' in bucket && Array.isArray(bucket.results) ? bucket.results : [];

      if (startTime === null || endTime === null) return null;

      const total = results.reduce((summary, result) => {
        if (typeof result !== 'object' || result === null || !('amount' in result) || typeof result.amount !== 'object' || result.amount === null) {
          return summary;
        }

        const amount = result.amount;
        return {
          currency: summary.currency || ('currency' in amount && typeof amount.currency === 'string' ? amount.currency : 'usd'),
          value: summary.value + ('value' in amount && typeof amount.value === 'number' ? amount.value : 0),
        };
      }, {
        currency: 'usd',
        value: 0,
      });

      return {
        startTime,
        endTime,
        amount: total,
      };
    })
    .filter((bucket): bucket is OpenAIProjectCostBucket => bucket !== null)
    .sort((left, right) => left.startTime - right.startTime);
}

export function extractUsageBuckets(data: unknown): OpenAIProjectUsageBucket[] {
  if (typeof data !== 'object' || data === null || !('data' in data) || !Array.isArray(data.data)) {
    return [];
  }

  return data.data
    .map(bucket => {
      if (typeof bucket !== 'object' || bucket === null) return null;

      const startTime = 'start_time' in bucket && typeof bucket.start_time === 'number' ? bucket.start_time : null;
      const endTime = 'end_time' in bucket && typeof bucket.end_time === 'number' ? bucket.end_time : null;
      const results = 'result' in bucket && Array.isArray(bucket.result)
        ? bucket.result
        : 'results' in bucket && Array.isArray(bucket.results)
          ? bucket.results
          : [];

      if (startTime === null || endTime === null) return null;

      return {
        startTime,
        endTime,
        results: results
          .map(result => {
            if (typeof result !== 'object' || result === null) return null;

            return {
              model: 'model' in result && typeof result.model === 'string' ? result.model : 'unknown',
              serviceTier: 'service_tier' in result && typeof result.service_tier === 'string' ? result.service_tier : 'default',
              inputTokens: 'input_tokens' in result && typeof result.input_tokens === 'number' ? result.input_tokens : 0,
              cachedTokens: 'input_cached_tokens' in result && typeof result.input_cached_tokens === 'number' ? result.input_cached_tokens : 0,
              outputTokens: 'output_tokens' in result && typeof result.output_tokens === 'number' ? result.output_tokens : 0,
              totalRequests: 'num_model_requests' in result && typeof result.num_model_requests === 'number' ? result.num_model_requests : 0,
            };
          })
          .filter((result): result is OpenAIProjectUsageResult => result !== null)
          .sort((left, right) => {
            if (left.model === right.model) {
              return left.serviceTier.localeCompare(right.serviceTier);
            }
            return left.model.localeCompare(right.model);
          }),
      };
    })
    .filter((bucket): bucket is OpenAIProjectUsageBucket => bucket !== null)
    .sort((left, right) => left.startTime - right.startTime);
}
