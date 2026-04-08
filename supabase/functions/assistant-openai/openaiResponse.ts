function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNestedOutputText(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.output)) {
    return '';
  }

  const parts = data.output
    .filter(isRecord)
    .flatMap(item => Array.isArray(item.content) ? item.content : [])
    .filter(isRecord)
    .filter(content => content.type === 'output_text' && typeof content.text === 'string')
    .map(content => content.text.trim())
    .filter(Boolean);

  return parts.join('\n').trim();
}

export function extractOutputText(data: unknown): string {
  if (isRecord(data) && typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  return getNestedOutputText(data);
}
