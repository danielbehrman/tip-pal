"use client"

import { useState } from "react"
import { FoodGroup, MaintenanceFood, WeeklyFood } from "@/lib/types"
import FoodCard from "./ui/FoodCard"
import CheckCircle from "./ui/CheckCircle"

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
  const checkedCount = keys.filter(k => !!checkedFoods[k]).length
  const allChecked = checkedCount === keys.length && keys.length > 0
  const someChecked = checkedCount > 0 && !allChecked

  function handleGroupCheck() {
    const newVal = !allChecked
    keys.forEach(k => onCheck(k, newVal))
  }

  // Sub-item label: comma-joined names
  const memberLabel = foods.map(({ food }) => food.name).join(", ")

  return (
    <>
      {/* Group card — shows partial border when some (not all) checked */}
      <FoodCard checked={allChecked} session="morning" partial={someChecked}>
        <div className="flex items-center gap-3">
          <CheckCircle
            checked={allChecked}
            partial={someChecked}
            session="morning"
            onClick={handleGroupCheck}
            disabled={disabled}
          />
          <div className="flex-1 min-w-0">
            <span
              className="font-medium block"
              style={{
                fontSize: 13,
                color: allChecked ? "var(--color-text-muted)" : "var(--color-text-primary)",
                textDecoration: allChecked ? "line-through" : "none",
              }}
            >
              {group.name}
            </span>
            <p
              className="truncate"
              style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 1 }}
            >
              {memberLabel}
            </p>
          </div>
          {/* Chevron — independent from checkbox */}
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-center justify-center ml-1 flex-shrink-0"
            style={{ width: 28, height: 28, color: "var(--color-text-muted)" }}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path
                d={expanded ? "M1 5L5 1L9 5" : "M1 1L5 5L9 1"}
                stroke="var(--color-text-muted)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </FoodCard>

      {/* Expanded sub-items */}
      {expanded && (
        <div className="ml-4 mb-[7px]">
          {foods.map(({ food, prefix }) => {
            const key = `${prefix}-${food.name}`
            const isChecked = !!checkedFoods[key]
            return (
              <div
                key={key}
                className="flex items-center gap-3 py-2"
                style={{ borderBottom: "0.5px solid var(--color-primary-border)" }}
              >
                <CheckCircle
                  checked={isChecked}
                  session="morning"
                  size={16}
                  onClick={() => !disabled && onCheck(key, !isChecked)}
                  disabled={disabled}
                />
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: 12, color: isChecked ? "var(--color-text-muted)" : "var(--color-text-primary)", textDecoration: isChecked ? "line-through" : "none" }}>
                    {food.name}
                  </span>
                  <p style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>
                    {food.dose} {food.unit}
                    {"prepNote" in food && food.prepNote ? ` · ${food.prepNote}` : ""}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
