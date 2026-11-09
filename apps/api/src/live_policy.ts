/**
 * Pure LIVE policy helpers used by HTTP handlers and Node tests.
 * Database-backed authentication and room membership checks remain in routes.
 */
export function canModerate(hostId: string, actorId: string): boolean {
  return Boolean(hostId) && hostId === actorId;
}

export function canBan(hostId: string, actorId: string, targetId: string): boolean {
  return canModerate(hostId,actorId) && targetId !== hostId;
}

export function canPublish(
  hostId: string, actorId: string, banned: boolean,
  seatStatus: string | null, seatNumber: number | null,
): boolean {
  if (banned) return false;
  if (hostId === actorId) return true;
  return seatStatus === 'ACTIVE' && seatNumber !== null &&
    Number.isInteger(seatNumber) && seatNumber >= 1 && seatNumber <= 8;
}

export function validReportReason(reason: string): boolean {
  const n=reason.trim().length;
  return n>=5 && n<=250;
}
