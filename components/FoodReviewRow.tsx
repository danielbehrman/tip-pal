"use client"

import { MaintenanceFood, WeeklyFood } from "@/lib/types"

type EditableFood = MaintenanceFood | WeeklyFood

interface FoodReviewRowProps {
  food: EditableFood
  showCapped?: boolean
  onChange: (updated: EditableFood) => void
}

export default function FoodReviewRow({ food, showCapped = false, onChange }: FoodReviewRowProps) {
  const hasCapped = "capped" in food

  return (
    <div className="flex flex-col gap-2 py-3 border-b border-gray-100 last:border-0">
      <div className="flex gap-2 items-center flex-wrap">
        <div className="flex flex-col flex-1 min-w-32">
          <label className="text-xs text-gray-500 mb-0.5">Name</label>
          <input
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            value={food.name}
            onChange={(e) => onChange({ ...food, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col w-20">
          <label className="text-xs text-gray-500 mb-0.5">Dose</label>
          <input
            type="number"
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            value={food.dose}
            onChange={(e) => onChange({ ...food, dose: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div className="flex flex-col w-20">
          <label className="text-xs text-gray-500 mb-0.5">Unit</label>
          <input
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            value={food.unit}
            onChange={(e) => onChange({ ...food, unit: e.target.value })}
          />
        </div>
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <div className="flex flex-col flex-1 min-w-48">
          <label className="text-xs text-gray-500 mb-0.5">Prep note</label>
          <input
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
            value={food.prepNote ?? ""}
            placeholder="None"
            onChange={(e) =>
              onChange({ ...food, prepNote: e.target.value.trim() === "" ? null : e.target.value })
            }
          />
        </div>
        {showCapped && hasCapped && (
          <div className="flex flex-col justify-end">
            <label className="text-xs text-gray-500 mb-0.5">Capped</label>
            <div className="flex items-center h-8">
              <input
                type="checkbox"
                className="w-5 h-5"
                checked={(food as MaintenanceFood).capped}
                onChange={(e) => onChange({ ...food, capped: e.target.checked } as MaintenanceFood)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
