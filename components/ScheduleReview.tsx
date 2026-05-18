"use client"

import { ParsedSchedule, MaintenanceFood, WeeklyFood, TreatmentFood, TreatmentWeek } from "@/lib/types"
import FoodReviewRow from "./FoodReviewRow"

interface ScheduleReviewProps {
  schedule: ParsedSchedule
  onScheduleChange: (updated: ParsedSchedule) => void
  onConfirm: () => void
  onBack: () => void
}

export default function ScheduleReview({
  schedule,
  onScheduleChange,
  onConfirm,
  onBack,
}: ScheduleReviewProps) {
  function updateMaintenance(index: number, updated: MaintenanceFood) {
    const foods = [...schedule.maintenanceFoods]
    foods[index] = updated
    onScheduleChange({ ...schedule, maintenanceFoods: foods })
  }

  function updateWeekly(index: number, updated: WeeklyFood) {
    const foods = [...schedule.weeklyFoods]
    foods[index] = updated
    onScheduleChange({ ...schedule, weeklyFoods: foods })
  }

  function updateTreatmentWeek(foodIndex: number, weekIndex: number, updated: TreatmentWeek) {
    const foods = schedule.treatmentFoods.map((f, fi) => {
      if (fi !== foodIndex) return f
      const weeks = f.weeks.map((w, wi) => (wi === weekIndex ? updated : w))
      return { ...f, weeks }
    })
    onScheduleChange({ ...schedule, treatmentFoods: foods })
  }

  function updateTreatmentFoodName(foodIndex: number, name: string) {
    const foods = schedule.treatmentFoods.map((f, fi) =>
      fi === foodIndex ? { ...f, name } : f
    )
    onScheduleChange({ ...schedule, treatmentFoods: foods })
  }

  return (
    <div className="flex flex-col gap-6">
      <button
        onClick={onBack}
        className="text-sm text-slate-600 underline text-left"
      >
        ← Edit pasted text
      </button>

      {schedule.maintenanceFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Morning (daily)</h2>
          {schedule.maintenanceFoods.map((food, i) => (
            <FoodReviewRow
              key={i}
              food={food}
              showCapped={true}
              onChange={(updated) => updateMaintenance(i, updated as MaintenanceFood)}
            />
          ))}
        </section>
      )}

      {schedule.weeklyFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Morning (weekly — Day 7 only)</h2>
          {schedule.weeklyFoods.map((food, i) => (
            <FoodReviewRow
              key={i}
              food={food}
              showCapped={false}
              onChange={(updated) => updateWeekly(i, updated as WeeklyFood)}
            />
          ))}
        </section>
      )}

      {schedule.treatmentFoods.length > 0 && (
        <section>
          <h2 className="text-lg font-bold mb-2">Evening (treatment)</h2>
          {schedule.treatmentFoods.map((food, fi) => (
            <div key={fi} className="mb-4">
              <div className="flex flex-col mb-2">
                <label className="text-xs text-gray-500 mb-0.5">Food name</label>
                <input
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm font-medium"
                  value={food.name}
                  onChange={(e) => updateTreatmentFoodName(fi, e.target.value)}
                />
              </div>
              <div className="ml-2 border-l-2 border-gray-200 pl-3">
                {food.weeks.map((week, wi) => (
                  <div key={wi} className="flex gap-2 items-center flex-wrap py-2 border-b border-gray-100 last:border-0">
                    <span className="text-xs text-gray-500 w-14">Week {week.week}</span>
                    <div className="flex flex-col w-20">
                      <label className="text-xs text-gray-500 mb-0.5">Dose</label>
                      <input
                        type="number"
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        value={week.dose}
                        onChange={(e) =>
                          updateTreatmentWeek(fi, wi, {
                            ...week,
                            dose: parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </div>
                    <div className="flex flex-col w-20">
                      <label className="text-xs text-gray-500 mb-0.5">Unit</label>
                      <input
                        className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                        value={week.unit}
                        onChange={(e) =>
                          updateTreatmentWeek(fi, wi, { ...week, unit: e.target.value })
                        }
                      />
                    </div>
                    <div className="flex flex-col justify-end">
                      <label className="text-xs text-gray-500 mb-0.5">Final</label>
                      <div className="flex items-center h-8">
                        <input
                          type="checkbox"
                          className="w-5 h-5"
                          checked={week.isFinal}
                          onChange={(e) =>
                            updateTreatmentWeek(fi, wi, { ...week, isFinal: e.target.checked })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      <button
        onClick={onConfirm}
        className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl mt-2"
      >
        Confirm &amp; Save
      </button>
    </div>
  )
}
