# Phase 3.5 F6: History Screen Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the History screen with the warm design system: orange header, week-grouped collapsible day rows, AM/PM inline session detail.

**Architecture:** Full replacement of `DoseHistoryLog.tsx` and `app/history/page.tsx` header. Data model is unchanged — `fetchAllDoseLogDays()` returns `DoseLogDay[]` sorted most-recent-first; the component groups by `week`, preserving order. No changes to edit logic or `fetchAllDoseLogDays`.

**Tech Stack:** Next.js, React hooks, Tailwind + inline styles

## Global Constraints

- App name "Tip Pal" — never "TIP Pal"
- Colors: `#ff6b35` orange header/AM tag/filled pip, `#9b6fd4` PM tag, `#fffbf7` app bg, `#fff8f5` week header row bg, `#f0ddd4` dividers, `#2d1a0e` primary text, `#9a6a55` secondary text, `#c4927a` tertiary text
- Status dot colors: Complete `#22c55e`, AM skipped `#ff6b35`, PM skipped `#9b6fd4`, Both skipped `#9a6a55`
- BottomNav is globally in `app/layout.tsx` — do not touch it; body needs `pb-24`
- No changes to trailing 3-day edit logic (`/history/edit`)
- `npm run build` must pass with zero TypeScript errors

---

## File Map

| File | Change |
|---|---|
| `app/history/page.tsx` | Replace page header with orange header + Edit link; remove old Link/h1 |
| `components/DoseHistoryLog.tsx` | Full replacement — grouped weeks, collapsible day rows, AM/PM session detail |

---

## Data Model Reference

```ts
interface DoseLogDay {
  id: string
  week: number
  day: number
  completedAt: string         // ISO — used for date display
  checkedFoods: Record<string, boolean>  // keys: "morning-{name}", "morning-weekly-{name}", "evening-{name}"
  scheduleSnapshot: ParsedSchedule | null  // snapshot at time of logging; has .visitNumber, .maintenanceFoods, .weeklyFoods, .treatmentFoods
  morningSkipped: boolean
  eveningSkipped: boolean
}
```

`visitNumber` on `ParsedSchedule` is a raw parsed string, e.g. "9", "Launch", "Tolerance Visit 1". Format rule:
- If the string parses as a pure integer → display as "Visit N" (e.g. "9" → "Visit 9")
- Otherwise → display as-is (e.g. "Launch", "Tolerance Visit 1")

Week section label: `"Week {N} · {visitLabel}"` or `"Week {N}"` if no visitNumber.

Morning food keys: `morning-{name}` for maintenanceFoods; `morning-weekly-{name}` for weeklyFoods (day 7 only).
Evening food keys: `evening-{name}` for treatmentFoods (via `getTreatmentFoodsForWeek`).

---

### Task 1: History Screen Redesign

**Files:**
- Modify: `app/history/page.tsx`
- Modify: `components/DoseHistoryLog.tsx` — full replacement

**Interfaces:**
- `DoseHistoryLogProps` unchanged: `{ schedule: ParsedSchedule; days: DoseLogDay[] }`
- Imports to add/keep: `useState` from react; `getTreatmentFoodsForWeek` from `@/lib/schedule`; `Link` from `next/link`

- [ ] **Step 1: Replace `app/history/page.tsx`**

Replace the file contents entirely with:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import { getSession, fetchSchedule, fetchAllDoseLogDays } from "@/lib/supabase"
import DoseHistoryLog from "@/components/DoseHistoryLog"

export default function HistoryPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [days, setDays] = useState<DoseLogDay[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      let session
      try {
        session = await getSession()
      } catch {
        router.replace("/login")
        return
      }
      if (!session) {
        router.replace("/login")
        return
      }
      try {
        const [s, allDays] = await Promise.all([fetchSchedule(), fetchAllDoseLogDays()])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setDays(allDays)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading || !schedule) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      <header
        className="flex items-center justify-between px-4 pt-5 pb-4"
        style={{ background: "#ff6b35" }}
      >
        <h1 className="text-xl font-semibold text-white">History</h1>
        <Link
          href="/history/edit"
          className="text-sm font-medium"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          Edit
        </Link>
      </header>
      <DoseHistoryLog schedule={schedule} days={days} />
    </div>
  )
}
```

- [ ] **Step 2: Replace `components/DoseHistoryLog.tsx`**

Replace the entire file with:

```tsx
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
  "am-skipped":    { label: "AM skipped",   dotColor: "#ff6b35" },
  "pm-skipped":    { label: "PM skipped",   dotColor: "#9b6fd4" },
  "both-skipped":  { label: "Both skipped", dotColor: "#9a6a55" },
}

function getDayStatus(entry: DoseLogDay): DayStatus {
  if (entry.morningSkipped && entry.eveningSkipped) return "both-skipped"
  if (entry.morningSkipped) return "am-skipped"
  if (entry.eveningSkipped) return "pm-skipped"
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
  if (entry.eveningSkipped) return "Skipped"
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
  const status = getDayStatus(entry)
  const { label, dotColor } = STATUS_CONFIG[status]
  const morningText = getMorningText(entry, schedule)
  const eveningText = getEveningText(entry, schedule)

  return (
    <div style={{ borderBottom: "0.5px solid #f0ddd4" }}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-white"
        onClick={() => setExpanded(e => !e)}
      >
        <p className="text-sm font-medium text-left" style={{ color: "#2d1a0e" }}>
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
          <span className="text-xs" style={{ color: "#9a6a55" }}>
            {label}
          </span>
          <span style={{ color: "#c4927a", fontSize: 10 }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </button>

      {expanded && (
        <div
          className="px-4 py-3 flex flex-col gap-3"
          style={{ background: "#fffbf7" }}
        >
          <div className="flex items-start gap-3">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
              style={{ background: "#ff6b35", color: "#fff", marginTop: 1 }}
            >
              AM
            </span>
            <p className="text-sm" style={{ color: "#2d1a0e" }}>
              {morningText}
            </p>
          </div>
          <div className="flex items-start gap-3">
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded shrink-0"
              style={{ background: "#9b6fd4", color: "#fff", marginTop: 1 }}
            >
              PM
            </span>
            <p className="text-sm" style={{ color: "#2d1a0e" }}>
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
      <p className="px-4 pt-6 text-sm" style={{ color: "#9a6a55" }}>
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
            <div className="px-4 py-2" style={{ background: "#fff8f5" }}>
              <p
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: "#9a6a55" }}
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
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Full build**

```bash
npm run build 2>&1 | tail -8
```

Expected: `✓ Compiled successfully`, all pages generated.

- [ ] **Step 5: Commit**

```bash
git add app/history/page.tsx components/DoseHistoryLog.tsx
git commit -m "feat(f6): redesign History screen with week groups, collapsible day rows, AM/PM detail"
```
