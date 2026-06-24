"use client"

import { ParsedSchedule } from "@/lib/types"
import Link from "next/link"

interface RecommendedFoodsViewProps {
  schedule: ParsedSchedule
  currentWeek: number
  weekCounts: Record<string, number>
  onGive: (foodName: string) => void
  onUndo: (foodName: string) => void
}

export default function RecommendedFoodsView({
  schedule,
  currentWeek,
  weekCounts,
  onGive,
  onUndo,
}: RecommendedFoodsViewProps) {
  const recommendedFoods = schedule.recommendedFoods ?? []
  const medications = schedule.medications ?? []

  return (
    <div className="max-w-lg mx-auto px-4 py-6 min-h-screen flex flex-col">
      <div className="mb-6">
        <Link href="/daily" className="text-sm text-slate-600 underline">
          ← Daily view
        </Link>
        <h1 className="text-2xl font-bold mt-3">Recommended &amp; Medications</h1>
        <p className="text-sm text-gray-500 mt-1">Week {currentWeek}</p>
      </div>

      {recommendedFoods.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-700 mb-3 uppercase tracking-wide text-xs">
            Recommended foods
          </h2>
          <div className="flex flex-col gap-3">
            {recommendedFoods.map((food) => {
              const count = weekCounts[food.name] ?? 0
              const target = food.frequencyPerWeek
              return (
                <div
                  key={food.name}
                  className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between gap-4"
                >
                  <button
                    onClick={() => onGive(food.name)}
                    className="flex-1 text-left"
                    aria-label={`Mark ${food.name} as given`}
                  >
                    <p className="font-semibold text-slate-900">{food.name}</p>
                    <p className="text-sm text-gray-500">
                      {food.dose} {food.unit} &middot; {target}× per week
                    </p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {count > 0 && (
                      <button
                        onClick={() => onUndo(food.name)}
                        className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-lg text-gray-600 text-lg font-bold"
                        aria-label={`Undo one for ${food.name}`}
                      >
                        −
                      </button>
                    )}
                    <button
                      onClick={() => onGive(food.name)}
                      className="min-w-16 px-3 h-10 flex items-center justify-center bg-slate-100 rounded-xl"
                      aria-label={`${count} of ${target} this week`}
                    >
                      <span className="text-base font-bold text-slate-900">{count}</span>
                      <span className="text-xs text-gray-500 ml-1">/ {target}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Tap a food to mark it as given this week. Counter resets with each new protocol week.
          </p>
        </section>
      )}

      {medications.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-gray-700 mb-3 uppercase tracking-wide text-xs">
            Daily medications
          </h2>
          <div className="flex flex-col gap-3">
            {medications.map((med) => (
              <div
                key={med.name}
                className="bg-white border border-gray-200 rounded-xl p-4"
              >
                <p className="font-semibold text-slate-900">{med.name}</p>
                <p className="text-sm text-gray-500">
                  {med.dose} {med.unit} &middot; {med.frequency}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {recommendedFoods.length === 0 && medications.length === 0 && (
        <p className="text-gray-500 text-sm">
          No recommended foods or medications in your current schedule. Re-parse your plan of care to update.
        </p>
      )}
    </div>
  )
}
