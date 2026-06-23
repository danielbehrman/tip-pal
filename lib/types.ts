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

export interface RecommendedFood {
  name: string
  dose: number
  unit: string
  frequencyPerWeek: string
}

export interface Medication {
  name: string
  dose: string
  unit: string
  frequency: string
}

export interface ParsedSchedule {
  maintenanceFoods: MaintenanceFood[]
  weeklyFoods: WeeklyFood[]
  treatmentFoods: TreatmentFood[]
  recommendedFoods?: RecommendedFood[]
  medications?: Medication[]
}

export interface DoseLogDay {
  id: string
  week: number
  day: number
  completedAt: string
  checkedFoods: Record<string, boolean>
  scheduleSnapshot: ParsedSchedule | null
  morningSkipped: boolean
  eveningSkipped: boolean
}

export interface DoseState {
  currentWeek: number
  currentDay: number
  checkedFoods: Record<string, boolean>
  morningSkipped?: boolean
  eveningSkipped?: boolean
  completedDays?: Record<string, Record<string, boolean>>
  cycleStartDate: string
  skipCount: number
  floorWeek: number
  floorDay: number
  recommendedFoodCounts?: Record<string, Record<string, number>>
}

export interface DayRecord {
  date: string
  skipped: boolean
}
