import { ParsedSchedule, DoseState } from "./types"

const SCHEDULE_KEY = "joshy-schedule"
const STATE_KEY = "joshy-state"

export function getSchedule(): ParsedSchedule | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(SCHEDULE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as ParsedSchedule
  } catch {
    return null
  }
}

export function saveSchedule(schedule: ParsedSchedule): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule))
}

export function clearSchedule(): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(SCHEDULE_KEY)
}

export function getDoseState(): DoseState {
  if (typeof window === "undefined") {
    return { currentWeek: 1, currentDay: 1, checkedFoods: {} }
  }
  const raw = window.localStorage.getItem(STATE_KEY)
  if (!raw) return { currentWeek: 1, currentDay: 1, checkedFoods: {} }
  try {
    return JSON.parse(raw) as DoseState
  } catch {
    return { currentWeek: 1, currentDay: 1, checkedFoods: {} }
  }
}

export function saveDoseState(state: DoseState): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STATE_KEY, JSON.stringify(state))
}

export function clearDoseState(): void {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STATE_KEY)
}
