"use client"

import FoodCard from "./ui/FoodCard"
import CheckCircle from "./ui/CheckCircle"
import Badge from "./ui/Badge"

interface FoodItemProps {
  name: string
  dose: number | string
  unit: string
  prepNote: string | null
  capped: boolean
  session: "morning" | "evening" | "med"
  isWeekly?: boolean
  isContinuing?: boolean
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  weekBadge?: string
}

export default function FoodItem({
  name,
  dose,
  unit,
  prepNote,
  capped,
  session,
  isWeekly = false,
  isContinuing = false,
  checked,
  onChange,
  disabled = false,
  weekBadge,
}: FoodItemProps) {
  return (
    <FoodCard checked={checked} session={session}>
      <div className="flex items-center gap-3">
        <CheckCircle
          checked={checked}
          session={session}
          onClick={() => !disabled && onChange(!checked)}
          disabled={disabled}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="font-medium"
              style={{
                fontSize: 15,
                color: checked ? "#c4927a" : "#2d1a0e",
                textDecoration: checked ? "line-through" : "none",
              }}
            >
              {name}
            </span>
            {capped && <Badge variant="capped" />}
            {isWeekly && (
              <span
                className="font-semibold"
                style={{ fontSize: 9, background: "#e6f4f1", color: "#2a7a6b", padding: "2px 6px", borderRadius: 4 }}
              >
                Weekly
              </span>
            )}
            {weekBadge && <Badge variant="week" label={weekBadge} />}
            {isContinuing && (
              <span className="italic" style={{ fontSize: 9, color: "#c4927a" }}>
                Final dose
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, color: "#9a6a55", marginTop: 1 }}>
            {dose} {unit}
            {prepNote ? ` · ${prepNote}` : ""}
          </p>
        </div>
      </div>
    </FoodCard>
  )
}
