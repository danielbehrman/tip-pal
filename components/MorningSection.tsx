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
        {schedule.maintenanceFoods.map((food, i) => (
          <FoodItem
            key={`morning-${i}`}
            name={food.name}
            dose={food.dose}
            unit={food.unit}
            prepNote={food.prepNote}
            capped={food.capped}
            isWeekly={false}
            isContinuing={false}
            checked={!!checkedFoods[`morning-${i}`]}
            onChange={(val) => onCheck(`morning-${i}`, val)}
          />
        ))}
        {currentDay === 7 &&
          schedule.weeklyFoods.map((food, i) => (
            <FoodItem
              key={`morning-weekly-${i}`}
              name={food.name}
              dose={food.dose}
              unit={food.unit}
              prepNote={food.prepNote}
              capped={false}
              isWeekly={true}
              isContinuing={false}
              checked={!!checkedFoods[`morning-weekly-${i}`]}
              onChange={(val) => onCheck(`morning-weekly-${i}`, val)}
            />
          ))}
      </div>
    </section>
  )
}
