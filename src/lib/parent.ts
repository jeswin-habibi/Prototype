import type { Unit } from '../types'
import { toGrams } from './units'

/** The user-entered receipt fields for a parent batch (no id / derived columns). */
export interface ParentCore {
  item_code: string
  description: string
  category: string
  batch_id: string
  qty: number // unit count
  weight_per_unit: number
  weight_unit: Unit
  expiry_date: string | null
  total_cost: number
  warehouse_name: string
}

/** Total available weight of a parent batch in grams (qty × per-unit weight). */
export function parentTotalWeightG(c: Pick<ParentCore, 'qty' | 'weight_per_unit' | 'weight_unit'>): number {
  return (Number(c.qty) || 0) * toGrams(Number(c.weight_per_unit) || 0, c.weight_unit)
}

/**
 * Full DB row to insert/update (minus id / received_at / generated total_weight_g).
 * Keeps the legacy mirror columns (unit/quantity/unit_cost/total_value) consistent so the
 * not-yet-migrated job/dashboard screens keep reading correct weights & costs.
 */
export function parentRow(c: ParentCore) {
  const twg = parentTotalWeightG(c)
  const totalCost = Number(c.total_cost) || 0
  return {
    item_code: c.item_code,
    description: c.description,
    category: c.category,
    batch_id: c.batch_id,
    qty: Number(c.qty) || 0,
    weight_per_unit: Number(c.weight_per_unit) || 0,
    weight_unit: c.weight_unit,
    expiry_date: c.expiry_date,
    total_cost: totalCost,
    warehouse_name: c.warehouse_name,
    // legacy mirror (grams-based, see schema.sql)
    unit: 'g' as Unit,
    quantity: twg,
    total_value: totalCost,
    unit_cost: twg > 0 ? totalCost / twg : 0,
  }
}
