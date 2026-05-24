import { ParsedSchedule, TreatmentFood, TreatmentWeek } from "./types"

export type BufferResult =
  | { kind: "hidden" }
  | { kind: "past" }
  | { kind: "days"; count: number }

export function calculateBuffer(
  appointmentDateStr: string | null,
  anchorTimestamp: string | null
): BufferResult {
  if (!appointmentDateStr || !anchorTimestamp) return { kind: "hidden" }

  const [apptYear, apptMonth, apptDay] = appointmentDateStr.split("-").map(Number)
  const apptDate = new Date(apptYear, apptMonth - 1, apptDay)

  const today = new Date()
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (apptDate <= todayMidnight) return { kind: "past" }

  const anchorRaw = new Date(anchorTimestamp)
  const anchorMidnight = new Date(anchorRaw.getFullYear(), anchorRaw.getMonth(), anchorRaw.getDate())

  const bufferStart = new Date(anchorMidnight)
  bufferStart.setDate(bufferStart.getDate() + 1)

  const MS_PER_DAY = 1000 * 60 * 60 * 24
  const count = Math.round((apptDate.getTime() - bufferStart.getTime()) / MS_PER_DAY)

  if (count < 0) return { kind: "past" }
  return { kind: "days", count }
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
