// Shared database row types (mirror supabase/schema.sql)

export type JobStatus = 'Created' | 'Processing' | 'Completed'
export type Unit = 'kg' | 'g'

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

export interface ParentItem {
  id: string
  item_code: string
  description: string
  unit: Unit
  batch_id: string
  quantity: number
  expiry_date: string | null
  unit_cost: number
  total_value: number
  warehouse_name: string
  received_at: string
}

export interface RepackJob {
  id: string
  parent_item_id: string
  machine_code: string
  operator_code: string
  status: JobStatus
  shift: string | null
  created_at: string
  start_at: string | null
  complete_at: string | null
  parent?: ParentItem
}

export interface JobPackSize {
  id: string
  job_id: string
  pack_size_g: number
  expected_packs: number
  expected_output_g: number
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
  parent_item_id: string
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
  created_at: string
}
