"use client"

import { ParsedSchedule } from "@/lib/types"
import FoodItem from "./FoodItem"
import { getTreatmentFoodsForWeek } from "@/lib/schedule"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
}: EveningSectionProps) {
  const treatmentItems = getTreatmentFoodsForWeek(schedule, currentWeek)

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-1">Evening</h2>
      <p className="text-xs text-gray-500 mb-2">
        4 hrs after morning · 15 min between foods · 1 hr rest after
      </p>
      <div className="divide-y divide-gray-100">
        {treatmentItems.map(({ food, weekEntry, isContinuing }) => (
          <FoodItem
            key={`evening-${food.name}`}
            name={food.name}
            dose={weekEntry.dose}
            unit={weekEntry.unit}
            prepNote={null}
            capped={false}
            isWeekly={false}
            isContinuing={isContinuing}
            checked={!!checkedFoods[`evening-${food.name}`]}
            onChange={(val) => onCheck(`evening-${food.name}`, val)}
          />
        ))}
      </div>
    </section>
  )
}
