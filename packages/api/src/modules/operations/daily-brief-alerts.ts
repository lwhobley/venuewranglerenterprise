/** Pure alert-string builder for the daily brief. Order is significant (most operationally urgent first). */
export function buildDailyBriefAlerts(counts: {
  pendingRequestCount: number;
  lowStockCount: number;
  eightySixCount: number;
}): string[] {
  const { pendingRequestCount, lowStockCount, eightySixCount } = counts;
  return [
    pendingRequestCount > 0 ? `${pendingRequestCount} staff request${pendingRequestCount === 1 ? '' : 's'} pending` : null,
    lowStockCount > 0 ? `${lowStockCount} low-stock bar item${lowStockCount === 1 ? '' : 's'}` : null,
    eightySixCount > 0 ? `${eightySixCount} item${eightySixCount === 1 ? '' : 's'} on the 86 list` : null,
  ].filter((value): value is string => Boolean(value));
}
