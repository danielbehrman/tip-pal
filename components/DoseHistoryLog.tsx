"use client"

import { useState } from "react"
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import { getTreatmentFoodsForWeek } from "@/lib/schedule"

interface DoseHistoryLogProps {
  schedule: ParsedSchedule
  days: DoseLogDay[]
}

type DayStatus = "complete" | "am-skipped" | "pm-skipped" | "both-skipped"

const STATUS_CONFIG: Record<DayStatus, { label: string; dotColor: string }> = {
  "complete":      { label: "Complete",     dotColor: "#22c55e" },
  "am-skipped":    { label: "AM skipped",   dotColor: "var(--color-primary-mid)" },
  "pm-skipped":    { label: "PM skipped",   dotColor: "var(--color-treatment-check)" },
  "both-skipped":  { label: "Both skipped", dotColor: "var(--color-text-secondary)" },
}

function getDayStatus(entry: DoseLogDay, schedule: ParsedSchedule): DayStatus {
  const s = entry.scheduleSnapshot ?? schedule
  const eveningFoods = getTreatmentFoodsForWeek(s, entry.week).map(({ food }) => `evening-${food.name}`)
  const eveningSkipped = eveningFoods.length > 0 && !eveningFoods.some(key => entry.checkedFoods[key])
  if (entry.morningSkipped && eveningSkipped) return "both-skipped"
  if (entry.morningSkipped) return "am-skipped"
  if (eveningSkipped) return "pm-skipped"
  return "complete"
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

function formatVisitNumber(vn: string): string {
  const asNum = parseInt(vn.trim(), 10)
  if (!isNaN(asNum) && asNum.toString() === vn.trim()) return `Visit ${vn}`
  return vn
}

function getMorningText(entry: DoseLogDay, schedule: ParsedSchedule): string {
  if (entry.morningSkipped) return "Skipped"
  const s = entry.scheduleSnapshot ?? schedule
  const foods = [
    ...s.maintenanceFoods.map(f => ({ key: `morning-${f.name}`, name: f.name })),
    ...(entry.day === 7
      ? s.weeklyFoods.map(f => ({ key: `morning-weekly-${f.name}`, name: f.name }))
      : []),
  ]
  const given = foods.filter(f => entry.checkedFoods[f.key]).map(f => f.name)
  return given.length > 0 ? given.join(", ") : "None logged"
}

function getEveningText(entry: DoseLogDay, schedule: ParsedSchedule): string {
  const s = entry.scheduleSnapshot ?? schedule
  const foods = getTreatmentFoodsForWeek(s, entry.week).map(({ food }) => ({
    key: `evening-${food.name}`,
    name: food.name,
  }))
  const given = foods.filter(f => entry.checkedFoods[f.key]).map(f => f.name)
  return given.length > 0 ? given.join(", ") : "None logged"
}

function DayRow({
  entry,
  schedule,
}: {
  entry: DoseLogDay
  schedule: ParsedSchedule
}) {
  const [expanded, setExpanded] = useState(false)
  const status = getDayStatus(entry, schedule)
  const { label, dotColor } = STATUS_CONFIG[status]
  const morningText = getMorningText(entry, schedule)
  const eveningText = getEveningText(entry, schedule)

  return (
    <div style={{ borderBottom: "0.5px solid var(--color-primary-border)" }}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-white"
        onClick={() => setExpanded(e => !e)}
      >
        <p className="text-sm font-medium text-left" style={{ color: "var(--color-text-primary)" }}>
          {formatDate(entry.completedAt)} · Day {entry.day}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dotColor,
            }}
          />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            {label}
          </span>
          <span style={{ color: "var(--color-text-muted)", fontSize: 10 }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {expanded && (
        <div
          className="px-4 py-3 flex flex-col gap-3"
          style={{ background: "var(--color-bg)" }}
        >
          <div className="flex items-start gap-3">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
              style={{ background: "var(--color-primary-mid)", color: "#fff", marginTop: 1 }}
            >
              AM
            </span>
            <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>
              {morningText}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
              style={{ background: "var(--color-treatment-check)", color: "#fff", marginTop: 1 }}
            >
              PM
            </span>
            <p className="text-sm" style={{ color: "var(--color-text-primary)" }}>
              {eveningText}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function DoseHistoryLog({ schedule, days }: DoseHistoryLogProps) {
  if (days.length === 0) {
    return (
      <p className="px-4 pt-6 text-sm" style={{ color: "var(--color-text-secondary)" }}>
        No doses logged yet. Completed days will appear here.
      </p>
    )
  }

  // Group by week, preserving most-recent-first insertion order
  const weekGroups = new Map<number, DoseLogDay[]>()
  for (const day of days) {
    if (!weekGroups.has(day.week)) weekGroups.set(day.week, [])
    weekGroups.get(day.week)!.push(day)
  }

  return (
    <div className="flex flex-col pb-24">
      {[...weekGroups.entries()].map(([week, weekDays]) => {
        const firstDay = weekDays[0]
        const vn = firstDay.scheduleSnapshot?.visitNumber
        const visitPart = vn ? ` · ${formatVisitNumber(vn)}` : ""
        const sectionLabel = `Week ${week}${visitPart}`
        return (
          <div key={week}>
            <div className="px-4 py-2" style={{ background: "var(--color-bg-secondary)" }}>
              <p
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {sectionLabel}
              </p>
            </div>
            {weekDays.map(entry => (
              <DayRow key={entry.id} entry={entry} schedule={schedule} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
