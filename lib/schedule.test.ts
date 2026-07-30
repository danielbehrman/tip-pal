import { describe, it, expect } from "vitest"
import { applyCrossCategoryCredit } from "./schedule"
import { RecommendedFood } from "./types"

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
})
