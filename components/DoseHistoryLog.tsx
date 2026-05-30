"use client"

import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import { getTreatmentFoodsForWeek } from "@/lib/schedule"
import Link from "next/link"

interface DoseHistoryLogProps {
  schedule: ParsedSchedule
  days: DoseLogDay[]
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function FoodRow({ name, dose, unit, given }: { name: string; dose: number; unit: string; given: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1.5 text-sm ${given ? "text-gray-800" : "text-gray-400"}`}>
      <span>{name}</span>
      <span className="flex items-center gap-2">
        <span>{dose} {unit}</span>
        {given ? (
          <span className="text-green-600 font-medium">✓</span>
        ) : (
          <span className="text-gray-400 text-xs">Not given</span>
        )}
      </span>
    </div>
  )
}

export default function DoseHistoryLog({ schedule, days }: DoseHistoryLogProps) {
  if (days.length === 0) {
    return (
      <div className="mt-8 text-center">
        <p className="text-gray-500 text-sm">No doses logged yet.</p>
        <p className="text-gray-400 text-xs mt-1">
          Completed days will appear here after you tap Complete Day.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map(entry => {
        const s = entry.scheduleSnapshot ?? schedule
        const morningFoods = [
          ...s.maintenanceFoods.map(f => ({
            key: `morning-${f.name}`,
            name: f.name,
            dose: f.dose,
            unit: f.unit,
          })),
          ...(entry.day === 7
            ? s.weeklyFoods.map(f => ({
                key: `morning-weekly-${f.name}`,
                name: f.name,
                dose: f.dose,
                unit: f.unit,
              }))
            : []),
        ]

        const eveningFoods = getTreatmentFoodsForWeek(s, entry.week).map(
          ({ food, weekEntry }) => ({
            key: `evening-${food.name}`,
            name: food.name,
            dose: weekEntry.dose,
            unit: weekEntry.unit,
          })
        )

        return (
          <div key={entry.id} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
              <span className="font-semibold text-base">
                Week {entry.week}, Day {entry.day}
              </span>
              <span className="text-sm text-gray-500">{formatDate(entry.completedAt)}</span>
            </div>

            <div className="px-4 pt-3 pb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Morning</p>
              {entry.morningSkipped ? (
                <p className="text-sm text-gray-400 italic mb-3">Skipped</p>
              ) : (
                <div className="divide-y divide-gray-100 mb-3">
                  {morningFoods.map(f => (
                    <FoodRow
                      key={f.key}
                      name={f.name}
                      dose={f.dose}
                      unit={f.unit}
                      given={!!entry.checkedFoods[f.key]}
                    />
                  ))}
                </div>
              )}

              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Evening</p>
              {entry.eveningSkipped ? (
                <p className="text-sm text-gray-400 italic mb-2">Skipped</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {eveningFoods.map(f => (
                    <FoodRow
                      key={f.key}
                      name={f.name}
                      dose={f.dose}
                      unit={f.unit}
                      given={!!entry.checkedFoods[f.key]}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="px-4 pb-3 flex justify-end">
              <Link
                href={`/history/edit`}
                className="text-xs text-gray-400 underline"
              >
                Edit
              </Link>
            </div>
          </div>
        )
      })}
    </div>
  )
}
