import { describe, expect, it } from 'vitest';
import { parseMcpResponse } from '../../scripts/lib/mcp-response';

describe('hosted Employment acceptance response decoding', () => {
  const response = { jsonrpc: '2.0', id: 7, result: { protocolVersion: '2025-11-25' } };

  it('accepts an ordinary JSON response', () => {
    expect(parseMcpResponse(JSON.stringify(response), 'application/json', 7)).toEqual(response);
  });

  it('selects the requested reply from SDK SSE events with CRLF and keepalives', () => {
    const stream = ': keepalive\r\n\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\n'
      + `event: message\r\ndata: ${JSON.stringify(response)}\r\n\r\n`;
    expect(parseMcpResponse(stream, 'text/event-stream; charset=utf-8', 7)).toEqual(response);
  });

  it('rejects a reply for another request', () => {
    expect(() => parseMcpResponse(JSON.stringify(response), 'application/json', 8)).toThrow('requested message');
  });

  it('does not expose a malformed response body in diagnostics', () => {
    expect(() => parseMcpResponse('data: private-fixture-value\n\n', 'text/event-stream', 7))
      .toThrow('MCP response did not contain valid JSON-RPC for the requested message.');
  });
});
