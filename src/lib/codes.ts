// Child SKU code + batch suffix generation.

/** e.g. parent "CASH20" + 50g -> "CASH20-50G" */
export function childItemCode(parentItemCode: string, packSizeG: number): string {
  return `${parentItemCode}-${packSizeG}G`
}

/** e.g. parent batch "B1001" index 0 -> "B1001CH01" */
export function childBatchId(parentBatchId: string, index: number): string {
  const suffix = String(index + 1).padStart(2, '0')
  return `${parentBatchId}CH${suffix}`
}

/** e.g. "Cashew" + 50g -> "Cashew 50g pack" */
export function childDescription(parentDescription: string, packSizeG: number): string {
  return `${parentDescription} ${packSizeG}g pack`
}
