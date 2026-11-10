import { Prisma } from '@prisma/client';

/** PostgreSQL serializable transactions may abort under contention. Retry only known transient conflicts. */
export function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export async function withSerializableRetry<T>(
  execute: () => Promise<T>,
  maxAttempts = 4
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await execute();
    } catch (error) {
      if (!isRetryableTransactionError(error) || attempt === maxAttempts - 1) throw error;
    }
  }
  throw new Error('Transaction retry limit exceeded');
}

/** Used for safe replay detection: a key must never be reusable with different gift details. */
export function sameGiftRequest(
  gift: { roomId: string; recipientId: string; giftCode: string },
  request: { roomId: string; recipientId: string; giftCode: string }
): boolean {
  return gift.roomId === request.roomId &&
    gift.recipientId === request.recipientId &&
    gift.giftCode === request.giftCode;
}

/** A successful wallet debit must be matched by an equal negative ledger entry. */
export function giftLedgerBalanced(gift: {
  costCoins: number; creatorPoints: number; agencyPoints: number; platformPoints: number
}): boolean {
  const values = [gift.costCoins, gift.creatorPoints, gift.agencyPoints, gift.platformPoints];
  return values.every(v => Number.isSafeInteger(v) && v >= 0) &&
    gift.costCoins === gift.creatorPoints + gift.agencyPoints + gift.platformPoints;
}
