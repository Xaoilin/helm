/** Keep the authored fixture draft: provider responses contain null optionals
 * that the strict MCP draft deliberately rejects. Only the concurrency token
 * comes from the server; never normalize or truncate it. */
export function hostedEquityUpdate(requestId: string, originalPosition: Record<string, unknown>,
  savedPosition: Record<string, unknown>) {
  const draft = { ...originalPosition };
  delete draft.id;
  return { requestId, positionId: originalPosition.id,
    position: { ...draft, ownedShares: 7 }, expectedUpdatedAt: savedPosition.updatedAt };
}
