import { ParsedSchedule, TreatmentFood, TreatmentWeek, FoodProgress } from "./types"

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
  slowestCompletedDays: number
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
    Math.round((apptDate.getTime() - finalDay7Date.getTime()) / MS_PER_DAY) - 1

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
