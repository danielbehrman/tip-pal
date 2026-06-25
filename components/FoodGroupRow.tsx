"use client"

import { useState } from "react"
import { FoodGroup, MaintenanceFood, WeeklyFood } from "@/lib/types"
import FoodItem from "./FoodItem"

interface FoodGroupRowProps {
  group: FoodGroup
  foods: Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }>
  checkedFoods: Record<string, boolean>
  disabled: boolean
  onCheck: (key: string, val: boolean) => void
}

export default function FoodGroupRow({
  group,
  foods,
  checkedFoods,
  disabled,
  onCheck,
}: FoodGroupRowProps) {
  const [expanded, setExpanded] = useState(false)

  const keys = foods.map(({ food, prefix }) => `${prefix}-${food.name}`)
  const checkedCount = keys.filter((k) => !!checkedFoods[k]).length
  const allChecked = checkedCount === keys.length && keys.length > 0
  const someChecked = checkedCount > 0 && !allChecked

  function handleGroupCheck(val: boolean) {
    keys.forEach((k) => onCheck(k, val))
  }

  return (
    <div className="py-1">
      <div className="flex items-center gap-3 py-2 min-h-[44px]">
        {/* Group checkbox */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleGroupCheck(!allChecked)}
          className={`w-6 h-6 shrink-0 rounded border-2 flex items-center justify-center
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
            ${allChecked
              ? "bg-slate-900 border-slate-900"
              : someChecked
              ? "bg-slate-300 border-slate-400"
              : "border-gray-400 bg-white"
            }`}
          aria-label={`${allChecked ? "Uncheck" : "Check"} all ${group.name} foods`}
        >
          {allChecked && (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
          {someChecked && <span className="text-white text-xs font-bold leading-none">−</span>}
        </button>

        {/* Group label */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex-1 flex items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <span className={`text-base font-medium ${allChecked ? "line-through text-gray-400" : ""}`}>
            {group.name}
          </span>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
            {foods.length} foods
          </span>
          <span className="text-gray-400 text-sm ml-auto">{expanded ? "▲" : "▼"}</span>
        </button>
      </div>

      {expanded && (
        <div className="ml-9 border-l-2 border-gray-100 pl-3">
          {foods.map(({ food, prefix }) => (
            <FoodItem
              key={`${prefix}-${food.name}`}
              name={food.name}
              dose={food.dose}
              unit={food.unit}
              prepNote={food.prepNote ?? null}
              capped={"capped" in food ? food.capped : false}
              isWeekly={prefix === "morning-weekly"}
              isContinuing={false}
              checked={!!checkedFoods[`${prefix}-${food.name}`]}
              disabled={disabled}
              onChange={(val) => onCheck(`${prefix}-${food.name}`, val)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
