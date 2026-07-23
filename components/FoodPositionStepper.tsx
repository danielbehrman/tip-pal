"use client"

export interface FoodPositionEntry {
  foodName: string
  week: number
  day: number
}

interface FoodPositionStepperProps {
  entries: FoodPositionEntry[]
  onChange: (foodName: string, week: number, day: number) => void
  disabled?: boolean
  badgeLabel?: string
  isBadged?: (foodName: string) => boolean
}

function RowDivider() {
  return <div style={{ height: "0.5px", background: "var(--color-primary-border)", marginLeft: 16 }} />
}

export default function FoodPositionStepper({
  entries,
  onChange,
  disabled = false,
  badgeLabel = "",
  isBadged,
}: FoodPositionStepperProps) {
  return (
    <>
      {entries.map(fp => (
        <div key={fp.foodName}>
          <div className="px-4 py-2">
            <span className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
              {fp.foodName}
              {isBadged?.(fp.foodName) && (
                <span
                  className="ml-2 text-xs px-2 py-0.5 rounded-full"
                  style={{ background: "var(--color-bg-secondary)", color: "var(--color-text-muted)" }}
                >
                  {badgeLabel}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Week</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onChange(fp.foodName, Math.max(1, fp.week - 1), fp.day)}
                disabled={fp.week <= 1 || disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                −
              </button>
              <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                {fp.week}
              </span>
              <button
                onClick={() => onChange(fp.foodName, fp.week + 1, fp.day)}
                disabled={disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                +
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>Day</span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onChange(fp.foodName, fp.week, Math.max(1, fp.day - 1))}
                disabled={fp.day <= 1 || disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                −
              </button>
              <span className="text-base font-semibold w-6 text-center" style={{ color: "var(--color-text-primary)" }}>
                {fp.day}
              </span>
              <button
                onClick={() => onChange(fp.foodName, fp.week, Math.min(7, fp.day + 1))}
                disabled={fp.day >= 7 || disabled}
                className="flex items-center justify-center text-lg font-bold disabled:opacity-30"
                style={{ width: 32, height: 32, borderRadius: 8, background: "var(--color-primary-border)", border: "none", color: "var(--color-text-primary)" }}
              >
                +
              </button>
            </div>
          </div>
          <RowDivider />
        </div>
      ))}
    </>
  )
}
