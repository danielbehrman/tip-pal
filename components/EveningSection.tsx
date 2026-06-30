"use client"

import { useState } from "react"
import { ParsedSchedule, FoodProgress } from "@/lib/types"
import FoodItem from "./FoodItem"
import { getTreatmentFoodEntry, foodsAreInSync } from "@/lib/schedule"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  onSkipDay: () => void
  isFutureDay: boolean
  isCurrentTreatmentDay: boolean
  isSkipped: boolean
  foodProgress: Map<string, FoodProgress>
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
  onSkipDay,
  isFutureDay,
  isCurrentTreatmentDay,
  isSkipped,
  foodProgress,
}: EveningSectionProps) {
  const [confirming, setConfirming] = useState(false)

  const inSync = foodsAreInSync(foodProgress)
  const treatmentFoods = schedule.treatmentFoods

  const allChecked = treatmentFoods.length > 0 && treatmentFoods.every(
    food => !!checkedFoods[`evening-${food.name}`]
  )
  const canSkip = isCurrentTreatmentDay && !isFutureDay && !allChecked && treatmentFoods.length > 0 && !isSkipped

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-1">Evening</h2>
      <p className="text-xs text-gray-500 mb-2">
        4 hrs after morning · 15 min between foods · 1 hr rest after
      </p>
      {isFutureDay ? (
        <div className="mt-2 px-4 py-3 bg-amber-50 border border-amber-300 rounded-xl">
          <p className="text-sm text-amber-900 font-medium">
            You haven&apos;t reached this treatment day yet
          </p>
        </div>
      ) : (
        <>
          <div className="divide-y divide-gray-100">
            {treatmentFoods.map(food => {
              const fp = foodProgress.get(food.name)
              const foodWeek = fp?.week ?? currentWeek
              const { weekEntry, isContinuing } = getTreatmentFoodEntry(food, foodWeek)
              const weekBadge = !inSync && fp ? `Wk ${fp.week}` : undefined
              return (
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
                  onChange={val => onCheck(`evening-${food.name}`, val)}
                  weekBadge={weekBadge}
                />
              )
            })}
          </div>

          {canSkip && (
            confirming ? (
              <div className="mt-3 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
                <p className="text-sm font-medium mb-3">
                  Skip this day? Tomorrow will repeat the same week and day. This can&apos;t be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    className="flex-1 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg"
                    onClick={() => { setConfirming(false); onSkipDay() }}
                  >
                    Yes — skip
                  </button>
                  <button
                    className="flex-1 py-2 bg-gray-200 text-gray-800 text-sm font-semibold rounded-lg"
                    onClick={() => setConfirming(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="mt-3 text-sm underline text-gray-500"
                onClick={() => setConfirming(true)}
              >
                Skip Day
              </button>
            )
          )}
        </>
      )}
    </section>
  )
}
