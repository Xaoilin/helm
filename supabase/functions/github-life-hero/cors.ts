export function withAllowedOriginCors(
  response: Response,
  origin: string | null,
  allowedOrigins: ReadonlySet<string>,
): Response {
  if (!origin || !allowedOrigins.has(origin)) return response;

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
