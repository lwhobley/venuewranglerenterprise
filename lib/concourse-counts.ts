export function requiredCount(value: string | undefined, label: string): number {
  if (!value?.trim() || !/^\d+(\.\d+)?$/.test(value.trim())) throw new Error(`Enter a non-negative number for ${label}.`);
  const count = Number(value);
  if (!Number.isFinite(count)) throw new Error(`${label} is too large.`);
  return count;
}

export function requiredCents(value: string, label: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error(`Enter ${label} with at most two decimal places.`);
  const cents = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error(`${label} is too large.`);
  return cents;
}
