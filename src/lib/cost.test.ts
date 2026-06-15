import { describe, it, expect } from 'vitest'
import { calculateCost, hoursBetween } from './cost'

describe('calculateCost', () => {
  const result = calculateCost({
    parentMaterialCost: 1000,
    inputWeightG: 20000, // 20 kg
    machineHours: 2,
    machineCostPerHour: 50,
    laborCostPerHour: 30,
    packLines: [
      { packSizeG: 50, actualPacks: 300, packagingPerUnit: 0.5 }, // 15000 g
      { packSizeG: 100, actualPacks: 40, packagingPerUnit: 0.8 }, // 4000 g
    ],
    wastage: [
      { reason: 'QC Rejects', grams: 600 },
      { reason: 'Shrinkage', grams: 400 },
    ],
  })

  it('computes output, wastage and variance weights', () => {
    expect(result.totalActualOutputG).toBe(19000)
    expect(result.totalWastageG).toBe(1000)
    expect(result.processVarianceG).toBe(0) // 20000 - 19000 - 1000
  })

  it('computes yield / wastage / lost-yield percentages', () => {
    expect(result.yieldPct).toBeCloseTo(95)
    expect(result.wastagePct).toBeCloseTo(5)
    expect(result.lostYieldPct).toBeCloseTo(5)
  })

  it('computes cost components', () => {
    expect(result.machineCost).toBe(100) // 2h * 50
    expect(result.laborCost).toBe(60) // 2h * 30
    expect(result.packagingCost).toBeCloseTo(300 * 0.5 + 40 * 0.8) // 182
    expect(result.totalRepackingCost).toBeCloseTo(182 + 100 + 60) // 342
    expect(result.totalBatchCost).toBeCloseTo(1342)
  })

  it('per-pack costs sum back to total batch cost (consistency)', () => {
    const sum = result.lines.reduce((s, l) => s + l.lineTotalCost, 0)
    expect(sum).toBeCloseTo(result.totalBatchCost, 6)
  })

  it('spreads non-packaging cost by weight', () => {
    // spreadable = 1000 + 100 + 60 = 1160 over 19000 g
    expect(result.spreadPerGram).toBeCloseTo(1160 / 19000, 9)
    const line50 = result.lines.find((l) => l.packSizeG === 50)!
    expect(line50.costPerPack).toBeCloseTo((1160 / 19000) * 50 + 0.5, 9)
  })
})

describe('hoursBetween', () => {
  it('returns hours between two ISO timestamps', () => {
    expect(hoursBetween('2026-06-15T10:00:00Z', '2026-06-15T12:30:00Z')).toBeCloseTo(2.5)
  })
  it('returns 0 when a timestamp is missing', () => {
    expect(hoursBetween(null, '2026-06-15T12:30:00Z')).toBe(0)
  })
})
