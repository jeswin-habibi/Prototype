// Shared database row types (mirror supabase/schema.sql)

export type JobStatus = 'Created' | 'Processing' | 'On Hold' | 'Completed'
export type Unit = 'kg' | 'g'
export type ProcessType = 'Machine' | 'Manual'
export type TimeEventType = 'start' | 'hold' | 'resume' | 'stop'

export interface Employee {
  id: string
  code: string
  name: string
  active: boolean
}

export interface Machine {
  id: string
  code: string
  name: string
  cost_per_hour_override: number | null
  active: boolean
}

export interface PackSize {
  id: string
  grams: number
  label: string
  active: boolean
}

export interface WastageReason {
  id: string
  name: string
  active: boolean
}

export interface CostingConfig {
  id: string
  machine_cost_per_hour: number
  labor_cost_per_hour: number
}

export interface PackagingCost {
  id: string
  pack_size_g: number
  cost_per_unit: number
}

/** Parent-Child Master: (parent_code, pack_size_g) → child SKU. Blends are rows under the blend's own code. */
export interface ParentChildMap {
  id: string
  parent_code: string
  parent_description: string
  category: string
  pack_size_g: number
  child_code: string
  child_description: string
  child_barcode: string
  active: boolean
}

export interface ParentItem {
  id: string
  item_code: string
  description: string
  category: string
  batch_id: string
  qty: number // unit count
  weight_per_unit: number
  weight_unit: Unit
  total_weight_g: number // generated: qty × per-unit weight in grams
  expiry_date: string | null
  total_cost: number
  warehouse_name: string
  received_at: string
  // [legacy] mirror columns kept until the job flow fully migrates (see schema.sql)
  unit: Unit
  quantity: number
  unit_cost: number
  total_value: number
}

export interface RepackJob {
  id: string
  parent_item_id: string | null // [legacy] single-parent link; inputs now live in job_parents
  machine_code: string | null
  operator_code: string
  process_type: ProcessType
  output_product_code: string | null
  status: JobStatus
  shift: string | null
  created_at: string
  start_at: string | null
  complete_at: string | null
  active_seconds: number | null
  parent?: ParentItem | null
}

/** One parent batch consumed by a job (the input list). */
export interface JobParent {
  id: string
  job_id: string
  parent_item_id: string
  required_weight_g: number
  material_cost: number
  parent?: ParentItem
}

export interface JobTimeEvent {
  id: string
  job_id: string
  event_type: TimeEventType
  at: string
}

export interface JobPackSize {
  id: string
  job_id: string
  pack_size_g: number
  expected_packs: number // [legacy] planned output (retired)
  expected_output_g: number // [legacy]
  actual_packs: number | null
  actual_output_g: number | null
}

export interface JobWastage {
  id: string
  job_id: string
  reason: string
  grams: number
}

export interface ChildSku {
  id: string
  job_id: string
  parent_item_id: string | null
  child_item_code: string
  description: string
  unit: string
  batch_id: string
  pack_size_g: number
  quantity: number
  expiry_date: string | null
  unit_cost: number
  total_value: number
  warehouse_name: string
  category: string
  child_barcode: string
  output_product_code: string | null
  created_at: string
}

export interface JobCostSnapshot {
  id: string
  job_id: string
  process_type: ProcessType
  output_product_code: string | null
  completed_on: string | null
  shift: string | null
  input_weight_g: number
  output_weight_g: number
  yield_pct: number
  lost_yield_pct: number
  wastage_g: number
  packs_produced: number
  active_seconds: number
  total_material_cost: number
  machine_cost: number
  labor_cost: number
  packaging_cost: number
  total_batch_cost: number
  created_at: string
}
