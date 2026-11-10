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

/** Compare the user's complete demo-ledger sum with cached wallet balances. */
export function reconcileDemoWallet(
  wallet: {coins:number;creatorPoints:number;agencyPoints:number},
  entries: Array<{walletType:string;delta:number}>
) {
  const totals={coins:0,creatorPoints:0,agencyPoints:0};
  for(const entry of entries){
    if(entry.walletType==='coins')totals.coins+=entry.delta;
    else if(entry.walletType==='creatorPoints')totals.creatorPoints+=entry.delta;
    else if(entry.walletType==='agencyPoints')totals.agencyPoints+=entry.delta;
  }
  return {
    consistent:wallet.coins===totals.coins &&
      wallet.creatorPoints===totals.creatorPoints &&
      wallet.agencyPoints===totals.agencyPoints,
    wallet:{coins:wallet.coins,creatorPoints:wallet.creatorPoints,agencyPoints:wallet.agencyPoints},
    ledgerTotals:totals
  };
}
