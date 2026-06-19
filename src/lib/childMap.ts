import type { JobParent, ParentChildMap } from '../types'
import { childDescription, childItemCode } from './codes'

export interface ResolvedChild {
  child_code: string
  child_description: string
  child_barcode: string
  category: string
  /** true when a Parent-Child Master row matched (vs. generated fallback) */
  mapped: boolean
}

/**
 * Resolve a child SKU's identity for an output product at a pack size from the
 * Parent-Child Master. Falls back to generated codes when no map row exists.
 */
export function resolveChild(
  map: ParentChildMap[],
  outputProductCode: string,
  sizeG: number,
  fallbackDescription: string,
): ResolvedChild {
  const row = map.find(
    (m) => m.parent_code === outputProductCode && Number(m.pack_size_g) === Number(sizeG),
  )
  if (row) {
    return {
      child_code: row.child_code || childItemCode(outputProductCode, sizeG),
      child_description: row.child_description || childDescription(row.parent_description || fallbackDescription, sizeG),
      child_barcode: row.child_barcode,
      category: row.category,
      mapped: true,
    }
  }
  return {
    child_code: childItemCode(outputProductCode, sizeG),
    child_description: childDescription(fallbackDescription, sizeG),
    child_barcode: '',
    category: '',
    mapped: false,
  }
}

/**
 * Child batch expiry rule: single input → that parent's expiry; multiple inputs →
 * the LATEST expiry among them (per business decision; earliest is safer for food).
 */
export function childExpiry(inputs: JobParent[]): string | null {
  const dates = inputs.map((i) => i.parent?.expiry_date).filter((d): d is string => !!d)
  if (dates.length === 0) return null
  dates.sort()
  return dates[dates.length - 1] ?? null
}
