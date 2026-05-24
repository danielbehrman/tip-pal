export interface MaintenanceFood {
  name: string
  dose: number
  unit: string
  capped: boolean
  prepNote: string | null
}

export interface WeeklyFood {
  name: string
  dose: number
  unit: string
  prepNote: string | null
}

export interface TreatmentWeek {
  week: number
  dose: number
  unit: string
  isFinal: boolean
}

export interface TreatmentFood {
  name: string
  weeks: TreatmentWeek[]
}

export interface ParsedSchedule {
  maintenanceFoods: MaintenanceFood[]
  weeklyFoods: WeeklyFood[]
  treatmentFoods: TreatmentFood[]
}

export interface DoseState {
  currentWeek: number
  currentDay: number
  checkedFoods: Record<string, boolean>
  // Snapshot of checkedFoods per completed day, keyed as "week-day".
  // Populated by Complete Day; used to restore state when navigating back.
  completedDays?: Record<string, Record<string, boolean>>
}
