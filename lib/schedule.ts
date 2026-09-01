import { ParsedSchedule, TreatmentFood, TreatmentWeek, FoodProgress, RecommendedFood, RampStep, RampTreatmentFood, RampMaintenanceFood, ReactionRamp, RampDoseOverride } from "./types"

export const MS_PER_DAY = 1000 * 60 * 60 * 24

export function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function formatDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function todayDateString(): string {
  return formatDateOnly(new Date())
}

export function addDays(dateStr: string, n: number): string {
  const d = parseDateOnly(dateStr)
  d.setDate(d.getDate() + n)
  return formatDateOnly(d)
}

export function positionIndexOf(week: number, day: number): number {
  return (week - 1) * 7 + (day - 1)
}

export function positionFromIndex(index: number): { week: number; day: number } {
  return { week: Math.floor(index / 7) + 1, day: (index % 7) + 1 }
}

/** Today's calendar-derived position. Never persisted by this function — callers decide whether to write it. */
export function getCalendarPosition(
  cycleStartDate: string,
  skipCount: number
): { week: number; day: number } {
  const start = parseDateOnly(cycleStartDate)
  const today = parseDateOnly(todayDateString())
  const dayIndex = Math.round((today.getTime() - start.getTime()) / MS_PER_DAY)
  const positionIndex = Math.max(0, dayIndex - skipCount)
  return positionFromIndex(positionIndex)
}

/** Inverse of getCalendarPosition — used by onboarding/Settings to re-anchor cycle_start_date from a chosen week/day, as of today. */
export function cycleStartDateForPosition(week: number, day: number): string {
  return addDays(todayDateString(), -positionIndexOf(week, day))
}

/** Forward projection — used by buffer calc to find the calendar date a future position (e.g. final week's Day 7) will fall on, assuming no further skips beyond skipCount. */
export function projectedDateForPosition(
  cycleStartDate: string,
  skipCount: number,
  week: number,
  day: number
): string {
  return addDays(cycleStartDate, positionIndexOf(week, day) + skipCount)
}

export type BufferResult =
  | { kind: "hidden" }
  | { kind: "past" }
  | { kind: "days"; count: number }
  | { kind: "behind"; count: number }

export function getTotalTreatmentWeeks(schedule: ParsedSchedule): number {
  if (schedule.treatmentFoods.length === 0) return 0
  return Math.max(...schedule.treatmentFoods.flatMap(f => f.weeks.map(w => w.week)))
}

export interface TreatmentFoodForWeek {
  food: TreatmentFood
  weekEntry: TreatmentWeek
  isContinuing: boolean
}

export function getTreatmentFoodsForWeek(
  schedule: ParsedSchedule,
  week: number
): TreatmentFoodForWeek[] {
  return schedule.treatmentFoods.map((food) => {
    const exactEntry = food.weeks.find((w) => w.week === week)
    if (exactEntry) {
      return { food, weekEntry: exactEntry, isContinuing: false }
    }
    // Week exceeds defined schedule — use last week's entry, mark as continuing
    const sortedWeeks = [...food.weeks].sort((a, b) => a.week - b.week)
    const lastEntry = sortedWeeks[sortedWeeks.length - 1]
    return { food, weekEntry: lastEntry, isContinuing: true }
  })
}

export function getTreatmentFoodEntry(
  food: TreatmentFood,
  week: number
): { weekEntry: TreatmentWeek; isContinuing: boolean } {
  const exactEntry = food.weeks.find(w => w.week === week)
  if (exactEntry) return { weekEntry: exactEntry, isContinuing: false }
  const sortedWeeks = [...food.weeks].sort((a, b) => a.week - b.week)
  const lastEntry = sortedWeeks[sortedWeeks.length - 1]
  return { weekEntry: lastEntry, isContinuing: true }
}

export function getGlobalPosition(
  progress: Map<string, FoodProgress>
): { week: number; day: number } {
  if (progress.size === 0) return { week: 1, day: 1 }
  let minIndex = Infinity
  let result = { week: 1, day: 1 }
  for (const fp of progress.values()) {
    const idx = (fp.week - 1) * 7 + (fp.day - 1)
    if (idx < minIndex) {
      minIndex = idx
      result = { week: fp.week, day: fp.day }
    }
  }
  return result
}

export function getFurthestAheadPosition(
  progress: Map<string, FoodProgress>
): { week: number; day: number } {
  if (progress.size === 0) return { week: 1, day: 1 }
  let maxIndex = -Infinity
  let result = { week: 1, day: 1 }
  for (const fp of progress.values()) {
    const idx = (fp.week - 1) * 7 + (fp.day - 1)
    if (idx > maxIndex) {
      maxIndex = idx
      result = { week: fp.week, day: fp.day }
    }
  }
  return result
}

export function parseFrequencyLow(freq: string): number {
  const match = freq.match(/\d+/)
  return match ? parseInt(match[0], 10) : 0
}

export function foodsAreInSync(progress: Map<string, FoodProgress>): boolean {
  if (progress.size <= 1) return true
  const values = [...progress.values()]
  const first = values[0]
  return values.every(fp => fp.week === first.week && fp.day === first.day)
}

export function calculateBufferFromProgress(
  appointmentDateStr: string | null,
  totalTreatmentWeeks: number,
  slowestWeek: number,
  slowestCompletedDays: number,
  fliesToAppointments: boolean
): BufferResult {
  if (!appointmentDateStr || totalTreatmentWeeks === 0) return { kind: "hidden" }

  const apptDate = parseDateOnly(appointmentDateStr)
  const todayMidnight = parseDateOnly(todayDateString())
  if (apptDate <= todayMidnight) return { kind: "past" }

  // remainingDays = calendar days from today until the slowest food reaches its final Day 7
  // Formula derived from: positionIndex(totalWeeks, 7) - positionIndex(slowestWeek, slowestDay)
  // where slowestDay = slowestCompletedDays + 1
  const remainingDays =
    (totalTreatmentWeeks - slowestWeek) * 7 + (6 - slowestCompletedDays)
  const finalDay7Date = parseDateOnly(addDays(todayDateString(), remainingDays))
  const bufferDays =
    Math.round((apptDate.getTime() - finalDay7Date.getTime()) / MS_PER_DAY) - 1 - (fliesToAppointments ? 1 : 0)

  if (bufferDays < 0) return { kind: "behind", count: Math.abs(bufferDays) }
  return { kind: "days", count: bufferDays }
}

export function getVisitIndex(visitNumber: string | null): number {
  if (!visitNumber) return 0
  const v = visitNumber.toLowerCase().trim()
  if (v === "launch") return 0
  if (v.startsWith("tolerance")) return v.includes("2") ? 22 : 21
  if (v.includes("annual")) return 24
  if (v.startsWith("remission")) return 23
  const numeric = v.startsWith("visit ") ? v.slice(6).trim() : v
  const n = parseInt(numeric, 10)
  return isNaN(n) ? 0 : Math.min(n, 20)
}

// Maps a medication frequency string to which sessions it should appear in.
// Defaults to morning for once-daily medications.
export function getMedicationSessions(frequency: string): ("morning" | "evening")[] {
  const f = frequency.toLowerCase()
  if (
    f.includes("twice") || f.includes("bid") ||
    f.includes("2x") || f.includes("2 times") || f.includes("twice daily")
  ) {
    return ["morning", "evening"]
  }
  if (f.includes("evening") || f.includes("pm") || f.includes("night") || f.includes("bedtime")) {
    return ["evening"]
  }
  return ["morning"]
}

// Longest-first so "morning-weekly-"/"morning-med-" aren't shadowed by the shorter "morning-" prefix.
const FOOD_KEY_PREFIXES = ["morning-weekly-", "morning-med-", "evening-med-", "morning-", "evening-"]

function stripFoodKeyPrefix(key: string): string | null {
  for (const prefix of FOOD_KEY_PREFIXES) {
    if (key.startsWith(prefix)) {
      if (prefix.includes("-med-")) return null
      return key.slice(prefix.length)
    }
  }
  return null
}

// Credits/debits a checked-food's weekly Recommended Foods count when its name
// matches a recommendedFoods entry. Returns null when there's nothing to change
// (no match, or val === wasChecked — the transition guard that prevents a bulk
// group-check from double-crediting members already at the target state).
export function applyCrossCategoryCredit(
  recommendedFoods: RecommendedFood[],
  counts: Record<string, Record<string, number>>,
  weekKey: string,
  key: string,
  val: boolean,
  wasChecked: boolean
): Record<string, Record<string, number>> | null {
  if (val === wasChecked) return null

  const foodName = stripFoodKeyPrefix(key)
  if (foodName === null) return null

  const matchedFood = recommendedFoods.find(f => f.name.toLowerCase() === foodName.toLowerCase())
  if (!matchedFood) return null

  const weekCounts = counts[weekKey] ?? {}
  const current = weekCounts[matchedFood.name] ?? 0
  const updated = val ? current + 1 : Math.max(0, current - 1)

  return {
    ...counts,
    [weekKey]: { ...weekCounts, [matchedFood.name]: updated },
  }
}

export function treatmentRampDone(ramp: ReactionRamp): boolean {
  return ramp.treatmentFoods.length === 0 || ramp.treatmentFoods.every(f => f.complete)
}

export function treatmentRampActive(ramp: ReactionRamp | null): boolean {
  if (!ramp) return false
  return ramp.active && !treatmentRampDone(ramp)
}

interface RampStepState {
  steps: RampStep[]
  currentStep: number
  daysInStep: number
  complete: boolean
}

export function advanceRampStepState(
  state: RampStepState
): { currentStep: number; daysInStep: number; complete: boolean } {
  if (state.complete) {
    return { currentStep: state.currentStep, daysInStep: state.daysInStep, complete: true }
  }
  const step = state.steps[state.currentStep]
  if (!step) {
    return { currentStep: state.currentStep, daysInStep: state.daysInStep, complete: true }
  }
  const daysInStep = state.daysInStep + 1
  if (daysInStep >= step.days) {
    const nextStep = state.currentStep + 1
    if (nextStep >= state.steps.length) {
      return { currentStep: state.currentStep, daysInStep, complete: true }
    }
    return { currentStep: nextStep, daysInStep: 0, complete: false }
  }
  return { currentStep: state.currentStep, daysInStep, complete: false }
}

export function getRampOverrides(
  ramp: ReactionRamp | null
): { treatment: Map<string, RampDoseOverride>; maintenance: Map<string, RampDoseOverride> } {
  const treatment = new Map<string, RampDoseOverride>()
  const maintenance = new Map<string, RampDoseOverride>()
  if (!ramp) return { treatment, maintenance }

  if (treatmentRampActive(ramp)) {
    for (const food of ramp.treatmentFoods) {
      if (food.complete) {
        treatment.set(food.name, { dose: food.returnDose, unit: food.returnUnit, capped: food.wasCapped })
        continue
      }
      const step = food.steps[food.currentStep]
      if (step) {
        treatment.set(food.name, { dose: step.dose, unit: step.unit, capped: food.wasCapped })
      }
    }
  }

  if (ramp.active) {
    for (const food of ramp.maintenanceFoods) {
      if (food.complete) continue
      const step = food.steps[food.currentStep]
      if (step) {
        maintenance.set(food.name, { dose: step.dose, unit: step.unit })
      }
    }
  }

  return { treatment, maintenance }
}

export interface DayAdvanceResult {
  updatedProgress: Map<string, FoodProgress>
  updatedRampTreatmentFoods: RampTreatmentFood[]
  updatedRampMaintenanceFoods: RampMaintenanceFood[]
}

// Decides, per checked food, whether its PERMANENT position (treatment_food_progress)
// advances or its RAMP STEP advances instead — a food actively ramping (present in
// ramp.treatmentFoods and the ramp's treatment side not yet fully done) is frozen here;
// its ramp entry advances instead via advanceRampStepState. Every other checked
// treatment food advances treatment_food_progress exactly as it always has. Maintenance
// ramp foods advance independently, gated only on that specific food being checked
// (morning-<name>) and not yet complete. Shared by handleCompleteDay (today's live
// checkboxes) and the lazy auto-rollover reconciliation (a missed prior day's saved
// checkbox snapshot) — both must resolve a day's checked foods identically.
export function advanceProgressForDay(
  schedule: ParsedSchedule,
  checkedFoods: Record<string, boolean>,
  foodProgress: Map<string, FoodProgress>,
  ramp: ReactionRamp | null,
  completedAt: string
): DayAdvanceResult {
  const wasTreatmentRampActive = treatmentRampActive(ramp)
  const updatedProgress = new Map(foodProgress)
  const updatedRampTreatmentFoods = ramp ? ramp.treatmentFoods.map(f => ({ ...f })) : []

  for (const food of schedule.treatmentFoods) {
    const key = `evening-${food.name}`
    if (!checkedFoods[key]) continue

    const rampIndex = updatedRampTreatmentFoods.findIndex(f => f.name === food.name)
    if (wasTreatmentRampActive && rampIndex !== -1) {
      const rampFood = updatedRampTreatmentFoods[rampIndex]
      updatedRampTreatmentFoods[rampIndex] = { ...rampFood, ...advanceRampStepState(rampFood) }
      continue
    }

    const fp = updatedProgress.get(food.name)
    if (!fp) continue
    const newCompletedDays = fp.completedDays + 1
    if (newCompletedDays >= 7) {
      updatedProgress.set(food.name, { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: completedAt })
    } else {
      updatedProgress.set(food.name, { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: completedAt })
    }
  }

  const updatedRampMaintenanceFoods = ramp
    ? ramp.maintenanceFoods.map(f => {
        if (f.complete) return { ...f }
        if (!checkedFoods[`morning-${f.name}`]) return { ...f }
        return { ...f, ...advanceRampStepState(f) }
      })
    : []

  return { updatedProgress, updatedRampTreatmentFoods, updatedRampMaintenanceFoods }
}

export interface RampAdvanceResult {
  nextRamp: ReactionRamp
  justFinishedTreatment: boolean
  fullyDone: boolean
}

// Given a ramp and its post-advancement treatment/maintenance food arrays (from
// advanceProgressForDay), decides: did the treatment side just transition from
// not-done to done this call (justFinishedTreatment — gates the one-time
// appendPreviousRamp history write), and is the WHOLE ramp now done, treatment
// and maintenance both (fullyDone — gates clearing reaction_ramp back to
// inactive). Callers still own the actual I/O (appendPreviousRamp/saveReactionRamp)
// and the rampDay increment decision — this only computes what the resulting
// ramp object and its two lifecycle flags should be.
export function resolveRampAfterAdvance(
  ramp: ReactionRamp,
  updatedRampTreatmentFoods: RampTreatmentFood[],
  updatedRampMaintenanceFoods: RampMaintenanceFood[],
  wasTreatmentRampActive: boolean
): RampAdvanceResult {
  const nextRamp: ReactionRamp = {
    ...ramp,
    rampDay: ramp.active ? ramp.rampDay + 1 : ramp.rampDay,
    treatmentFoods: updatedRampTreatmentFoods,
    maintenanceFoods: updatedRampMaintenanceFoods,
  }
  const justFinishedTreatment = wasTreatmentRampActive && treatmentRampDone(nextRamp)
  const fullyDone = treatmentRampDone(nextRamp) && nextRamp.maintenanceFoods.every(f => f.complete)
  return { nextRamp, justFinishedTreatment, fullyDone }
}
