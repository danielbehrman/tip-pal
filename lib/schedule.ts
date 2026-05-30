import { ParsedSchedule, TreatmentFood, TreatmentWeek } from "./types"

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
