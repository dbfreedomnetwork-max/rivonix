export const GIFT_CATALOG = {
  rose: { label: 'Rose', coins: 10 },
  star: { label: 'Star', coins: 50 },
  comet: { label: 'Comet', coins: 100 },
} as const;

export type GiftCode = keyof typeof GIFT_CATALOG;

/** Entirely virtual demo-point allocation, not currency or cash. */
export function splitDemoGift(coins: number, hasAgency: boolean) {
  if (!Number.isSafeInteger(coins) || coins <= 0) throw new Error('Invalid demo gift amount');
  const creator = Math.floor(coins * 50 / 100);
  const agency = hasAgency ? Math.floor(coins * 15 / 100) : 0;
  const platform = coins - creator - agency;
  return { creator, agency, platform };
}

export function demoEconomyEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV !== 'production' && env.RIVONIX_DEMO_ECONOMY === 'true';
}
