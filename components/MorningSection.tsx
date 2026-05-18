"use client"

import { ParsedSchedule } from "@/lib/types"
import FoodItem from "./FoodItem"

interface MorningSectionProps {
  schedule: ParsedSchedule
  currentDay: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
}

export default function MorningSection({
  schedule,
  currentDay,
  checkedFoods,
  onCheck,
}: MorningSectionProps) {
  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-2">Morning</h2>
      <div className="divide-y divide-gray-100">
        {schedule.maintenanceFoods.map((food) => (
          <FoodItem
            key={`morning-${food.name}`}
            name={food.name}
            dose={food.dose}
            unit={food.unit}
            prepNote={food.prepNote}
            capped={food.capped}
            isWeekly={false}
            isContinuing={false}
            checked={!!checkedFoods[`morning-${food.name}`]}
            onChange={(val) => onCheck(`morning-${food.name}`, val)}
          />
        ))}
        {currentDay === 7 &&
          schedule.weeklyFoods.map((food) => (
            <FoodItem
              key={`morning-weekly-${food.name}`}
              name={food.name}
              dose={food.dose}
              unit={food.unit}
              prepNote={food.prepNote}
              capped={false}
              isWeekly={true}
              isContinuing={false}
              checked={!!checkedFoods[`morning-weekly-${food.name}`]}
              onChange={(val) => onCheck(`morning-weekly-${food.name}`, val)}
            />
          ))}
      </div>
    </section>
  )
}
