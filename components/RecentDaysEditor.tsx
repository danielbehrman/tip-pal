"use client"

import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import { getTreatmentFoodsForWeek } from "@/lib/schedule"
import FoodItem from "./FoodItem"

interface RecentDaysEditorProps {
  schedule: ParsedSchedule
  days: DoseLogDay[]
  onToggle: (id: string, key: string, val: boolean, current: Record<string, boolean>) => void
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export default function RecentDaysEditor({ schedule, days, onToggle }: RecentDaysEditorProps) {
  if (days.length === 0) {
    return (
      <p className="text-gray-500 text-sm mt-4">
        No completed days logged yet. Complete Day entries will appear here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {days.map(entry => {
        const s = entry.scheduleSnapshot ?? schedule
        const morningFoods = [
          ...s.maintenanceFoods.map(f => ({
            key: `morning-${f.name}`,
            name: f.name,
            dose: f.dose,
            unit: f.unit,
            prepNote: f.prepNote,
            capped: f.capped,
            isWeekly: false,
            isContinuing: false,
          })),
          ...(entry.day === 7
            ? s.weeklyFoods.map(f => ({
                key: `morning-weekly-${f.name}`,
                name: f.name,
                dose: f.dose,
                unit: f.unit,
                prepNote: f.prepNote,
                capped: false,
                isWeekly: true,
                isContinuing: false,
              }))
            : []),
        ]

        const eveningFoods = getTreatmentFoodsForWeek(s, entry.week).map(
          ({ food, weekEntry, isContinuing }) => ({
            key: `evening-${food.name}`,
            name: food.name,
            dose: weekEntry.dose,
            unit: weekEntry.unit,
            prepNote: null,
            capped: false,
            isWeekly: false,
            isContinuing,
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

            <div className="px-4 pt-3 pb-1">
              <p className="text-sm font-semibold text-gray-600 mb-1">Morning</p>
              {entry.morningSkipped ? (
                <p className="text-sm text-gray-400 italic mb-3">Morning session skipped</p>
              ) : (
                <div className="divide-y divide-gray-100 mb-3">
                  {morningFoods.map(f => (
                    <FoodItem
                      key={f.key}
                      name={f.name}
                      dose={f.dose}
                      unit={f.unit}
                      prepNote={f.prepNote}
                      capped={f.capped}
                      session="morning"
                      isWeekly={f.isWeekly}
                      isContinuing={f.isContinuing}
                      checked={!!entry.checkedFoods[f.key]}
                      onChange={val => onToggle(entry.id, f.key, val, entry.checkedFoods)}
                    />
                  ))}
                </div>
              )}

              <p className="text-sm font-semibold text-gray-600 mb-1">Evening</p>
              {entry.eveningSkipped ? (
                <p className="text-sm text-gray-400 italic mb-3">Evening session skipped</p>
              ) : (
                <div className="divide-y divide-gray-100 mb-3">
                  {eveningFoods.map(f => (
                    <FoodItem
                      key={f.key}
                      name={f.name}
                      dose={f.dose}
                      unit={f.unit}
                      prepNote={f.prepNote}
                      capped={f.capped}
                      session="evening"
                      isWeekly={f.isWeekly}
                      isContinuing={f.isContinuing}
                      checked={!!entry.checkedFoods[f.key]}
                      onChange={val => onToggle(entry.id, f.key, val, entry.checkedFoods)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
