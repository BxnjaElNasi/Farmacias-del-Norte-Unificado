/**
 * @param {Array<{id: string, quantity: number | string, expiresOn?: string | Date | null, createdAt?: string | Date}>} lots
 * @param {number} quantity
 */
export function allocateLotsFefo(lots, quantity) {
  const ordered = [...lots]
    .filter((lot) => Number(lot.quantity) > 0)
    .sort((left, right) => {
      const leftExpiry = left.expiresOn ? new Date(left.expiresOn).getTime() : Number.POSITIVE_INFINITY;
      const rightExpiry = right.expiresOn ? new Date(right.expiresOn).getTime() : Number.POSITIVE_INFINITY;
      if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
      const leftCreated = left.createdAt ? new Date(left.createdAt).getTime() : 0;
      const rightCreated = right.createdAt ? new Date(right.createdAt).getTime() : 0;
      return leftCreated - rightCreated;
    });

  let remaining = quantity;
  const allocations = [];
  for (const lot of ordered) {
    if (remaining === 0) break;
    const taken = Math.min(remaining, Number(lot.quantity));
    allocations.push({ lotId: lot.id, quantity: taken });
    remaining -= taken;
  }
  return { allocations, remaining };
}
