// Pure cost-calculation module for a repacking job.
//
// Allocation rule (approved): packaging is a DIRECT per-size cost; parent material,
// machine, and labor are spread across good output by WEIGHT (grams). This makes the
// per-pack costs sum back exactly to the total batch cost.

export interface PackLineInput {
  packSizeG: number
  actualPacks: number
  packagingPerUnit: number
}

export interface WastageInput {
  reason: string
  grams: number
}

export interface CostInputs {
  parentMaterialCost: number
  inputWeightG: number
  packLines: PackLineInput[]
  machineHours: number
  machineCostPerHour: number
  laborCostPerHour: number
  wastage: WastageInput[]
}

export interface PackLineResult extends PackLineInput {
  actualOutputG: number
  packagingCost: number
  costPerPack: number
  lineTotalCost: number
}

export interface CostResult {
  // yield / loss
  inputWeightG: number
  totalActualOutputG: number
  totalWastageG: number
  processVarianceG: number
  yieldPct: number
  wastagePct: number
  lostYieldPct: number
  // costs
  parentMaterialCost: number
  machineCost: number
  laborCost: number
  packagingCost: number
  totalRepackingCost: number
  totalBatchCost: number
  spreadPerGram: number
  blendedCostPerGram: number
  lines: PackLineResult[]
}

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b
}

export function calculateCost(input: CostInputs): CostResult {
  const totalActualOutputG = input.packLines.reduce(
    (sum, l) => sum + l.packSizeG * l.actualPacks,
    0,
  )
  const totalWastageG = input.wastage.reduce((sum, w) => sum + w.grams, 0)
  const processVarianceG = input.inputWeightG - totalActualOutputG - totalWastageG

  const machineCost = input.machineHours * input.machineCostPerHour
  const laborCost = input.machineHours * input.laborCostPerHour
  const packagingCost = input.packLines.reduce(
    (sum, l) => sum + l.actualPacks * l.packagingPerUnit,
    0,
  )

  const totalRepackingCost = packagingCost + machineCost + laborCost
  const totalBatchCost = input.parentMaterialCost + totalRepackingCost

  // Spread everything EXCEPT direct packaging by good-output weight.
  const spreadable = input.parentMaterialCost + machineCost + laborCost
  const spreadPerGram = safeDiv(spreadable, totalActualOutputG)

  const lines: PackLineResult[] = input.packLines.map((l) => {
    const actualOutputG = l.packSizeG * l.actualPacks
    const costPerPack = spreadPerGram * l.packSizeG + l.packagingPerUnit
    return {
      ...l,
      actualOutputG,
      packagingCost: l.actualPacks * l.packagingPerUnit,
      costPerPack,
      lineTotalCost: costPerPack * l.actualPacks,
    }
  })

  return {
    inputWeightG: input.inputWeightG,
    totalActualOutputG,
    totalWastageG,
    processVarianceG,
    yieldPct: safeDiv(totalActualOutputG, input.inputWeightG) * 100,
    wastagePct: safeDiv(totalWastageG, input.inputWeightG) * 100,
    lostYieldPct: safeDiv(input.inputWeightG - totalActualOutputG, input.inputWeightG) * 100,
    parentMaterialCost: input.parentMaterialCost,
    machineCost,
    laborCost,
    packagingCost,
    totalRepackingCost,
    totalBatchCost,
    spreadPerGram,
    blendedCostPerGram: safeDiv(totalBatchCost, totalActualOutputG),
    lines,
  }
}

/** Hours between two ISO timestamps (0 if either missing). */
export function hoursBetween(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return 0
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime()
  return ms > 0 ? ms / 3_600_000 : 0
}
