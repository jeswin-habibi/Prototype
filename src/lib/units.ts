import type { Unit } from '../types'

/** Convert a quantity in the given unit to grams. */
export function toGrams(quantity: number, unit: Unit): number {
  return unit === 'kg' ? quantity * 1000 : quantity
}

/** Pretty-print grams, switching to kg above 1000g. */
export function formatWeight(grams: number): string {
  if (Math.abs(grams) >= 1000) return `${(grams / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`
  return `${grams.toLocaleString(undefined, { maximumFractionDigits: 1 })} g`
}
