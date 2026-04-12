function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeOutputText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isJsonObjectString(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function getNestedOutputTextCandidates(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.output)) {
    return [];
  }

  return data.output
    .filter(isRecord)
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(isRecord)
    .filter(content => content.type === 'output_text' && typeof content.text === 'string')
    .map(content => normalizeOutputText(content.text))
    .filter(Boolean);
}

export function extractOutputText(data: unknown): string {
  const topLevel = isRecord(data) ? normalizeOutputText(data.output_text) : '';
  const nested = getNestedOutputTextCandidates(data);
  const nestedJoined = nested.length > 1 ? normalizeOutputText(nested.join('')) : '';
  const candidates = dedupe([
    topLevel,
    nestedJoined,
    ...nested,
  ].filter(Boolean));

  const jsonCandidate = candidates.find(isJsonObjectString);
  if (jsonCandidate) {
    return jsonCandidate;
  }

  return candidates[0] || '';
}
