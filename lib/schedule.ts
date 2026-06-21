import { ParsedSchedule, TreatmentFood, TreatmentWeek } from "./types"

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

export function calculateBuffer(
  appointmentDateStr: string | null,
  totalTreatmentWeeks: number
): BufferResult {
  if (!appointmentDateStr || totalTreatmentWeeks === 0) return { kind: "hidden" }

  const [apptYear, apptMonth, apptDay] = appointmentDateStr.split("-").map(Number)
  const apptDate = new Date(apptYear, apptMonth - 1, apptDay)

  const today = new Date()
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (apptDate <= todayMidnight) return { kind: "past" }

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const daysUntilAppt = Math.round((apptDate.getTime() - todayMidnight.getTime()) / MS_PER_DAY)
  const bufferDays = daysUntilAppt - totalTreatmentWeeks * 7

  if (bufferDays < 0) return { kind: "behind", count: Math.abs(bufferDays) }
  return { kind: "days", count: bufferDays }
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
