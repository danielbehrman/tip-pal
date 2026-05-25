"use client"

import { useState } from "react"
import { ParsedSchedule } from "@/lib/types"
import FoodItem from "./FoodItem"
import { getTreatmentFoodsForWeek } from "@/lib/schedule"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  skipped: boolean
  onSkip: () => void
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
  skipped,
  onSkip,
}: EveningSectionProps) {
  const [confirming, setConfirming] = useState(false)
  const treatmentItems = getTreatmentFoodsForWeek(schedule, currentWeek)

  return (
    <section className="mb-6">
      <h2 className="text-xl font-bold mb-1">Evening</h2>
      <p className="text-xs text-gray-500 mb-2">
        4 hrs after morning · 15 min between foods · 1 hr rest after
      </p>
      {skipped ? (
        <p className="text-sm text-gray-400 italic px-1">Evening session skipped</p>
      ) : (
        <>
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
          {confirming ? (
            <div className="flex items-center justify-between mt-3 px-2 py-2 bg-gray-100 rounded-xl">
              <span className="text-sm font-medium">Skip evening session?</span>
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
              Skip evening session
            </button>
          )}
        </>
      )}
    </section>
  )
}
