import { describe, it, expect } from "vitest"
import { applyCrossCategoryCredit, treatmentRampDone, treatmentRampActive, advanceRampStepState, getRampOverrides } from "./schedule"
import { RecommendedFood, ReactionRamp, RampTreatmentFood, RampMaintenanceFood } from "./types"

const recommendedFoods: RecommendedFood[] = [
  { name: "Pea Protein", dose: 1, unit: "tsp", frequencyPerWeek: "3-5" },
  { name: "Chia Seeds", dose: 1, unit: "tsp", frequencyPerWeek: "3-5" },
]

describe("applyCrossCategoryCredit", () => {
  it("credits a matching food on check", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "morning-Pea Protein", true, false)
    expect(result).toEqual({ "1": { "Pea Protein": 1 } })
  })

  it("debits a matching food on uncheck", () => {
    const counts = { "1": { "Pea Protein": 2 } }
    const result = applyCrossCategoryCredit(recommendedFoods, counts, "1", "morning-Pea Protein", false, true)
    expect(result).toEqual({ "1": { "Pea Protein": 1 } })
  })

  it("returns null when the food name does not match any recommended food", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "morning-Sunflower Butter", true, false)
    expect(result).toBeNull()
  })

  it("skips morning medication keys", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "morning-med-Pea Protein", true, false)
    expect(result).toBeNull()
  })

  it("skips evening medication keys", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "evening-med-Chia Seeds", true, false)
    expect(result).toBeNull()
  })

  it("applies the transition guard — no-op when val equals wasChecked", () => {
    // This is the case that prevents a bulk group-check from double-crediting
    // members that were already at the target state in a partial-check group.
    const counts = { "1": { "Pea Protein": 1 } }
    const result = applyCrossCategoryCredit(recommendedFoods, counts, "1", "morning-Pea Protein", true, true)
    expect(result).toBeNull()
  })

  it("floors the count at 0 — cannot go negative", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "morning-Pea Protein", false, true)
    expect(result).toEqual({ "1": { "Pea Protein": 0 } })
  })

  it("matches case-insensitively but stores under the recommendedFoods entry's canonical casing", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "evening-pea protein", true, false)
    expect(result).toEqual({ "1": { "Pea Protein": 1 } })
  })

  it("matches weekly foods (morning-weekly- prefix)", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "morning-weekly-Chia Seeds", true, false)
    expect(result).toEqual({ "1": { "Chia Seeds": 1 } })
  })

  it("matches treatment (evening-) foods, confirming category-independence", () => {
    const result = applyCrossCategoryCredit(recommendedFoods, {}, "1", "evening-Chia Seeds", true, false)
    expect(result).toEqual({ "1": { "Chia Seeds": 1 } })
  })

  it("does not mutate the input counts object", () => {
    const counts = { "1": { "Pea Protein": 1 } }
    applyCrossCategoryCredit(recommendedFoods, counts, "1", "morning-Pea Protein", true, false)
    expect(counts).toEqual({ "1": { "Pea Protein": 1 } })
  })

  it("scopes credit to the given weekKey, leaving other weeks untouched", () => {
    const counts = { "1": { "Pea Protein": 3 } }
    const result = applyCrossCategoryCredit(recommendedFoods, counts, "2", "morning-Pea Protein", true, false)
    expect(result).toEqual({ "1": { "Pea Protein": 3 }, "2": { "Pea Protein": 1 } })
  })

  it("regression: sequential calls within a bulk group-check must thread each call's output into the next, or deltas are lost", () => {
    // Mirrors FoodGroupRow.handleGroupCheck firing onCheck once per member,
    // synchronously, in one tick — this is why the caller must feed each call's
    // return value into the next (via a ref), not call every member against the
    // same pre-batch counts snapshot.
    let counts: Record<string, Record<string, number>> = {}

    const afterFirst = applyCrossCategoryCredit(recommendedFoods, counts, "1", "morning-Pea Protein", true, false)
    expect(afterFirst).not.toBeNull()
    counts = afterFirst!

    const afterSecond = applyCrossCategoryCredit(recommendedFoods, counts, "1", "morning-Chia Seeds", true, false)
    expect(afterSecond).not.toBeNull()
    counts = afterSecond!

    expect(counts).toEqual({ "1": { "Pea Protein": 1, "Chia Seeds": 1 } })

    // The bug this guards against: computing both calls against the *original*
    // stale snapshot instead of threading the output would silently drop one.
    const staleBoth = applyCrossCategoryCredit(recommendedFoods, {}, "1", "morning-Chia Seeds", true, false)
    expect(staleBoth).not.toEqual(counts)
  })
})

function makeTreatmentFood(overrides: Partial<RampTreatmentFood> = {}): RampTreatmentFood {
  return {
    name: "Peanut Gelatin",
    steps: [{ dose: 10, unit: "ml", days: 3 }, { dose: 20, unit: "ml", days: 3 }],
    returnDose: 30,
    returnUnit: "ml",
    wasCapped: false,
    currentStep: 0,
    daysInStep: 0,
    complete: false,
    ...overrides,
  }
}

function makeMaintenanceFood(overrides: Partial<RampMaintenanceFood> = {}): RampMaintenanceFood {
  return {
    name: "Denatured Donkey Milk",
    steps: [{ dose: 60, unit: "ml", days: 5 }],
    currentStep: 0,
    daysInStep: 0,
    complete: false,
    ...overrides,
  }
}

function makeRamp(overrides: Partial<ReactionRamp> = {}): ReactionRamp {
  return {
    active: true,
    startedAt: "2026-08-01T00:00:00.000Z",
    rampDay: 0,
    startedAtWeek: 3,
    startedAtDay: 2,
    treatmentFoods: [makeTreatmentFood()],
    maintenanceFoods: [],
    ...overrides,
  }
}

describe("treatmentRampDone", () => {
  it("is false when at least one treatment food is incomplete", () => {
    expect(treatmentRampDone(makeRamp())).toBe(false)
  })

  it("is true when every treatment food is complete", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ complete: true })] })
    expect(treatmentRampDone(ramp)).toBe(true)
  })

  it("is true when there are no treatment foods in the ramp", () => {
    expect(treatmentRampDone(makeRamp({ treatmentFoods: [] }))).toBe(true)
  })
})

describe("treatmentRampActive", () => {
  it("is false for a null ramp", () => {
    expect(treatmentRampActive(null)).toBe(false)
  })

  it("is true when ramp is active and treatment side isn't done", () => {
    expect(treatmentRampActive(makeRamp())).toBe(true)
  })

  it("is false once treatment side is done, even if ramp.active is still true (maintenance tail)", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ complete: true })] })
    expect(treatmentRampActive(ramp)).toBe(false)
  })

  it("is false when ramp.active is false", () => {
    expect(treatmentRampActive(makeRamp({ active: false }))).toBe(false)
  })
})

describe("advanceRampStepState", () => {
  it("increments daysInStep without rolling when below the step's day count", () => {
    const result = advanceRampStepState(makeTreatmentFood({ daysInStep: 0 }))
    expect(result).toEqual({ currentStep: 0, daysInStep: 1, complete: false })
  })

  it("rolls to the next step and resets daysInStep when the step's day count is reached", () => {
    const result = advanceRampStepState(makeTreatmentFood({ currentStep: 0, daysInStep: 2 }))
    expect(result).toEqual({ currentStep: 1, daysInStep: 0, complete: false })
  })

  it("marks complete when the last step's day count is reached", () => {
    const result = advanceRampStepState(makeTreatmentFood({ currentStep: 1, daysInStep: 2 }))
    expect(result).toEqual({ currentStep: 1, daysInStep: 3, complete: true })
  })

  it("is a no-op once already complete", () => {
    const result = advanceRampStepState(makeTreatmentFood({ complete: true, currentStep: 1, daysInStep: 3 }))
    expect(result).toEqual({ currentStep: 1, daysInStep: 3, complete: true })
  })

  it("works identically for a maintenance food (shared shape)", () => {
    const result = advanceRampStepState(makeMaintenanceFood({ daysInStep: 4 }))
    expect(result).toEqual({ currentStep: 0, daysInStep: 5, complete: true })
  })
})

describe("getRampOverrides", () => {
  it("returns empty maps for a null ramp", () => {
    const { treatment, maintenance } = getRampOverrides(null)
    expect(treatment.size).toBe(0)
    expect(maintenance.size).toBe(0)
  })

  it("returns empty maps for an inactive ramp", () => {
    const { treatment, maintenance } = getRampOverrides(makeRamp({ active: false }))
    expect(treatment.size).toBe(0)
    expect(maintenance.size).toBe(0)
  })

  it("overrides a stepping treatment food with its current step's dose, unit, and wasCapped", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ wasCapped: true })] })
    const { treatment } = getRampOverrides(ramp)
    expect(treatment.get("Peanut Gelatin")).toEqual({ dose: 10, unit: "ml", capped: true })
  })

  it("holds a completed treatment food at returnDose while siblings are still stepping", () => {
    const ramp = makeRamp({
      treatmentFoods: [
        makeTreatmentFood({ name: "Peanut Gelatin", complete: true, wasCapped: true }),
        makeTreatmentFood({ name: "Cashew", complete: false }),
      ],
    })
    const { treatment } = getRampOverrides(ramp)
    expect(treatment.get("Peanut Gelatin")).toEqual({ dose: 30, unit: "ml", capped: true })
    expect(treatment.get("Cashew")).toEqual({ dose: 10, unit: "ml", capped: false })
  })

  it("removes all treatment overrides once every treatment food is complete, even for foods still holding at returnDose", () => {
    const ramp = makeRamp({ treatmentFoods: [makeTreatmentFood({ complete: true })] })
    const { treatment } = getRampOverrides(ramp)
    expect(treatment.size).toBe(0)
  })

  it("overrides a stepping maintenance food with its current step's dose and unit, no capped field", () => {
    const ramp = makeRamp({ maintenanceFoods: [makeMaintenanceFood()] })
    const { maintenance } = getRampOverrides(ramp)
    expect(maintenance.get("Denatured Donkey Milk")).toEqual({ dose: 60, unit: "ml" })
  })

  it("excludes a completed maintenance food from overrides", () => {
    const ramp = makeRamp({ maintenanceFoods: [makeMaintenanceFood({ complete: true })] })
    const { maintenance } = getRampOverrides(ramp)
    expect(maintenance.has("Denatured Donkey Milk")).toBe(false)
  })

  it("keeps maintenance overrides active even after the treatment side is fully done", () => {
    const ramp = makeRamp({
      treatmentFoods: [makeTreatmentFood({ complete: true })],
      maintenanceFoods: [makeMaintenanceFood()],
    })
    const { treatment, maintenance } = getRampOverrides(ramp)
    expect(treatment.size).toBe(0)
    expect(maintenance.get("Denatured Donkey Milk")).toEqual({ dose: 60, unit: "ml" })
  })

  it("produces zero maintenance overrides for an inactive ramp, even with a non-complete maintenance food", () => {
    const ramp = makeRamp({ active: false, maintenanceFoods: [makeMaintenanceFood()] })
    const { treatment, maintenance } = getRampOverrides(ramp)
    expect(treatment.size).toBe(0)
    expect(maintenance.size).toBe(0)
  })
})
