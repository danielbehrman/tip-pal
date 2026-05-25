"use client"

import { useState } from "react"
import { ParsedSchedule } from "@/lib/types"
import FoodItem from "./FoodItem"

interface MorningSectionProps {
  schedule: ParsedSchedule
  currentDay: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  skipped: boolean
  onSkip: () => void
}

export default function MorningSection({
  schedule,
  currentDay,
  checkedFoods,
  onCheck,
  skipped,
  onSkip,
}: MorningSectionProps) {
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-2">Morning</h2>
      {skipped ? (
        <p className="text-sm text-gray-400 italic px-1">Morning session skipped</p>
      ) : (
        <>
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
          {confirming ? (
            <div className="flex items-center justify-between mt-3 px-2 py-2 bg-gray-100 rounded-xl">
              <span className="text-sm font-medium">Skip morning session?</span>
              <div className="flex gap-3">
                <button
                  className="px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
                  onClick={() => { setConfirming(false); onSkip() }}
                >
                  Yes
                </button>
                <button
                  className="px-4 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg"
                  onClick={() => setConfirming(false)}
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <button
              className="mt-2 text-sm text-gray-400 underline"
              onClick={() => setConfirming(true)}
            >
              Skip morning session
            </button>
          )}
        </>
      )}
    </section>
  )
}
