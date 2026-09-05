"use client"

import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import { classifyDoseLogDay, DayStatus, todayDateString, formatDateOnly } from "@/lib/schedule"

interface HistoryCalendarProps {
  schedule: ParsedSchedule
  monthDays: DoseLogDay[]
  month: { year: number; month: number }
  onMonthChange: (next: { year: number; month: number }) => void
  onDayClick: (dateStr: string, entry: DoseLogDay | null) => void
  selectMode: boolean
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  earliestMonth: { year: number; month: number }
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function DayStatusIcon({ status }: { status: DayStatus | null }) {
  if (status === "complete") {
    return (
      <span
        style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--color-complete)" }}
        className="flex items-center justify-center text-xs font-bold"
      >
        <span style={{ color: "var(--color-complete)" }}>✓</span>
      </span>
    )
  }
  if (status === "treatment-complete") {
    return <span style={{ color: "var(--color-complete)", fontSize: 16, fontWeight: 700 }}>✓</span>
  }
  if (status === "treatment-partial") {
    return <span style={{ width: 16, height: 3, background: "var(--color-complete)", borderRadius: 2, display: "inline-block" }} />
  }
  if (status === "treatment-missed") {
    return <span style={{ color: "var(--color-danger)", fontSize: 16, fontWeight: 700 }}>✕</span>
  }
  return null
}

export default function HistoryCalendar({
  schedule,
  monthDays,
  month,
  onMonthChange,
  onDayClick,
  selectMode,
  selectedIds,
  onToggleSelect,
  earliestMonth,
}: HistoryCalendarProps) {
  const { year, month: m } = month
  const firstOfMonth = new Date(year, m - 1, 1)
  const leadingBlanks = firstOfMonth.getDay()
  const daysInMonth = new Date(year, m, 0).getDate()
  const todayStr = todayDateString()

  const byDate = new Map<string, DoseLogDay>()
  for (const d of monthDays) byDate.set(formatDateOnly(new Date(d.completedAt)), d)

  const atEarliest = year === earliestMonth.year && m === earliestMonth.month
  const atCurrentMonth = (() => {
    const now = new Date()
    return year === now.getFullYear() && m === now.getMonth() + 1
  })()

  function goPrevMonth() {
    if (atEarliest) return
    onMonthChange(m === 1 ? { year: year - 1, month: 12 } : { year, month: m - 1 })
  }
  function goNextMonth() {
    if (atCurrentMonth) return
    onMonthChange(m === 12 ? { year: year + 1, month: 1 } : { year, month: m + 1 })
  }

  return (
    <div className="px-4 pt-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <button onClick={goPrevMonth} disabled={atEarliest} className="disabled:opacity-30" aria-label="Previous month">‹</button>
        <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {MONTH_NAMES[m - 1]} {year}
        </p>
        <button onClick={goNextMonth} disabled={atCurrentMonth} className="disabled:opacity-30" aria-label="Next month">›</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
        {WEEKDAY_LABELS.map(w => (
          <div key={w} style={{ textAlign: "center", fontSize: 12, opacity: 0.6 }}>{w}</div>
        ))}

        {Array.from({ length: leadingBlanks }).map((_, i) => <div key={`blank-${i}`} />)}

        {Array.from({ length: daysInMonth }).map((_, i) => {
          const dayNum = i + 1
          const dateStr = `${year}-${pad2(m)}-${pad2(dayNum)}`
          const isFuture = dateStr > todayStr
          const isToday = dateStr === todayStr
          const entry = byDate.get(dateStr) ?? null
          const status = entry ? classifyDoseLogDay(entry, schedule) : null
          const selected = entry ? selectedIds.has(entry.id) : false

          return (
            <button
              key={dateStr}
              type="button"
              disabled={isFuture}
              onClick={() => {
                if (selectMode && entry) onToggleSelect(entry.id)
                else onDayClick(dateStr, entry)
              }}
              className="flex flex-col items-center gap-1"
              style={{
                padding: "8px 0",
                borderRadius: 8,
                opacity: isFuture ? 0.35 : 1,
                background: isToday
                  ? "var(--color-warning-bg)"
                  : selected
                  ? "var(--color-primary-border)"
                  : "var(--color-bg-secondary)",
                border: isToday ? "1px solid var(--color-warning-border)" : selected ? "1.5px solid var(--color-primary-mid)" : "none",
              }}
            >
              <span style={{ fontSize: 12, opacity: 0.8, fontWeight: isToday ? 700 : 400 }}>{dayNum}</span>
              {isToday ? (
                <span style={{ fontSize: 10, opacity: 0.6 }}>today</span>
              ) : (
                !isFuture && <DayStatusIcon status={status} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
