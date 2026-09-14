/** Decode the finite JSON or SSE response to one Streamable HTTP request. */
export function parseMcpResponse(text: string, contentType: string | null, expectedId: number): Record<string, unknown> {
  try {
    const messages: unknown[] = contentType?.includes('text/event-stream')
      ? text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n'))
        .filter(Boolean).map(data => JSON.parse(data))
      : [JSON.parse(text)];
    const response = messages.find((message): message is Record<string, unknown> =>
      typeof message === 'object' && message !== null && !Array.isArray(message)
      && 'jsonrpc' in message && message.jsonrpc === '2.0'
      && 'id' in message && message.id === expectedId);
    if (response) return response;
  } catch {
    // Never expose response bodies: they can contain account data or tokens.
  }
  throw new Error('MCP response did not contain valid JSON-RPC for the requested message.');
}
