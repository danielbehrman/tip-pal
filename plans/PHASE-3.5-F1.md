# F1: Daily View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the daily view to match the approved warm/family design — orange header with SVG visit-progress ring, buffer days row, day-by-day chevron navigator, redesigned food cards using F0 primitives (FoodCard, CheckCircle, Badge), medication cards inline in AM/PM sections, group food cards with dashed partial state, a persistent Complete Day button, and separate Skip morning (log only) / Skip evening (position freeze) links.

**Architecture:** DailyView.tsx is structurally rebuilt with a full-width orange header (avatar SVG ring, child name, appointment bubble, buffer days ⓘ row), replacing the old header div and appointment date input. The week/day ± buttons are replaced by a single-day chevron navigator. Food items and group cards are visually redesigned using already-existing F0 primitives (FoodCard, CheckCircle, Badge, SectionHeader, CTAButton) — the logic in MorningSection/EveningSection stays; only the rendering changes. Medications from `schedule.medications` are injected into morning/evening sections based on frequency string matching. `saveSkipMorning` is added to supabase.ts; `handleSkipMorning` wired through DailyView → EveningSection.

**Tech Stack:** Next.js 14 (App Router, "use client"), Tailwind CSS 4 (`@theme {}` tokens), Supabase (existing client), TypeScript. No new packages.

## Global Constraints

- App name is "Tip Pal" — never "TIP Pal" in any new UI copy.
- No personal names in the codebase or app.
- All Supabase reads/writes use the anon-key client from `@/lib/supabase` — no service role on the client.
- `process.env.NEXT_PUBLIC_API_BASE_URL ?? ''` prefix on all fetch calls to `/api/*`.
- Raw plan of care text must never be persisted.
- Color tokens from F0: `#ff6b35` primary/morning, `#9b6fd4` evening/med, `#4fc3f7` progress ring, `#fffbf7` app bg.
- Every task ends with `npm run build` — zero TypeScript errors is the gate.
- No scope beyond F1. Do not redesign any screen other than the daily view.
- `onAppointmentChange` prop is removed from DailyView in Task 1 — do not add it back.
- Dan reviews in production at tippal.behrman.dev — no local dev server required.

---

## File Structure

**Modified:**
- `lib/schedule.ts` — add `getVisitIndex`, `getMedicationSessions` helpers (Task 1)
- `components/DailyView.tsx` — full structural rebuild: orange header, buffer row, chevron navigator; remove appointment input + `onAppointmentChange`; add `onSkipMorning` (Task 1)
- `app/daily/page.tsx` — remove `handleAppointmentChange`/`appointmentDebounceRef`; add `handleSkipMorning`; update DailyView props (Task 1)
- `components/ui/FoodCard.tsx` — add `partial?: boolean` for dashed group state (Task 2)
- `components/ui/CheckCircle.tsx` — add `partial?: boolean` for dashed circle state (Task 2)
- `components/FoodItem.tsx` — add `session: "morning" | "evening" | "med"` prop; render via FoodCard + CheckCircle (Task 2)
- `components/FoodGroupRow.tsx` — visual redesign: dashed partial border, independent chevron on right, sub-items use new FoodItem (Task 2)
- `components/MorningSection.tsx` — add morning medication cards after food items (Task 3)
- `components/EveningSection.tsx` — add evening medication cards; persistent Complete Day button; Skip morning (log) + Skip evening (position freeze) links; `onSkipMorning` prop (Task 3)
- `lib/supabase.ts` — add `saveSkipMorning(week: number, day: number): Promise<void>` (Task 3)

**Not modified:** FoodCard session styles, SectionHeader, CTAButton, Badge, BottomNav, app/layout.tsx, history screens, settings, new-cycle flow, supabase RLS.

---

### Task 1: Schedule Helpers + DailyView Structural Rebuild

**Files:**
- Modify: `lib/schedule.ts`
- Modify: `components/DailyView.tsx`
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes: `ParsedSchedule`, `DoseState`, `DayRecord`, `FoodGroup`, `FoodProgress` from `@/lib/types`; `getTotalTreatmentWeeks`, `calculateBufferFromProgress`, `getGlobalPosition` from existing `@/lib/schedule`; existing `MorningSection`, `EveningSection`
- Produces for Task 3:
  - `getVisitIndex(visitNumber: string | null): number` — maps visit string → 0-24 index for SVG ring
  - `getMedicationSessions(frequency: string): ("morning" | "evening")[]` — maps frequency text → sessions

- [ ] **Step 1: Add `getVisitIndex` and `getMedicationSessions` to `lib/schedule.ts`**

Append these two exports after the existing exports in `lib/schedule.ts`:

```ts
export function getVisitIndex(visitNumber: string | null): number {
  if (!visitNumber) return 0
  const v = visitNumber.toLowerCase().trim()
  if (v === "launch") return 0
  if (v.startsWith("tolerance")) return v.includes("2") ? 22 : 21
  if (v.includes("annual")) return 24
  if (v.startsWith("remission")) return 23
  const n = parseInt(v, 10)
  return isNaN(n) ? 0 : Math.min(n, 20)
}

// Maps a medication frequency string to which sessions it should appear in.
// Defaults to morning for once-daily medications.
export function getMedicationSessions(frequency: string): ("morning" | "evening")[] {
  const f = frequency.toLowerCase()
  if (
    f.includes("twice") || f.includes("bid") ||
    f.includes("2x") || f.includes("2 times") || f.includes("twice daily")
  ) {
    return ["morning", "evening"]
  }
  if (f.includes("evening") || f.includes("pm") || f.includes("night") || f.includes("bedtime")) {
    return ["evening"]
  }
  return ["morning"]
}
```

- [ ] **Step 2: Verify TypeScript for lib/schedule.ts**

```bash
cd /Users/dan/Shipyard/tippal && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors from lib/schedule.ts.

- [ ] **Step 3: Rebuild `components/DailyView.tsx`**

Replace the entire file with the following. Read the existing file first so you understand what's being replaced. Key behavioral changes vs the old file:
- `onAppointmentChange` prop **removed** (appointment date is now read-only display in header bubble)
- `onSkipMorning` prop **added**
- Header is now a full-width orange `<header>` with SVG ring, child name, appointment bubble
- Buffer days row sits inside the orange header area
- Week/day ± buttons replaced by `handleNavigate(delta)` driving left/right chevron buttons
- `handleWeekChange` and `handleDayChange` removed
- Appointment date `<input>` removed entirely
- `previousDayIncomplete` warning now sits between the navigator and food sections
- `infoSheetOpen` state drives the ⓘ buffer-explanation slide-up sheet
- The `isAppointmentDay` card and food sections are unchanged in behavior

```tsx
"use client"

import { useState } from "react"
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress } from "@/lib/types"
import { getTotalTreatmentWeeks, calculateBufferFromProgress, getVisitIndex } from "@/lib/schedule"
import MorningSection from "./MorningSection"
import EveningSection from "./EveningSection"
import Link from "next/link"

interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (updater: (prev: DoseState) => DoseState) => void
  onCompleteDay: () => void
  onSkipDay: () => void
  onSkipMorning: () => void
  appointmentDate: string | null
  familyName: string | null
  completedPositions: Set<string>
  dayRecords: Map<string, DayRecord>
  treatmentAnchor: { week: number; day: number }
  previousDayIncomplete: boolean
  foodGroups: FoodGroup[]
  visitNumber: string | null
  isAppointmentDay: boolean
  foodProgress: Map<string, FoodProgress>
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

function getDaysToAppointment(appointmentDate: string | null): number | null {
  if (!appointmentDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const appt = new Date(appointmentDate + "T00:00:00")
  const diff = Math.round((appt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  return diff > 0 ? diff : null
}

const CIRCUMFERENCE = 2 * Math.PI * 26 // ≈ 163.4

const BUFFER_INFO_COPY =
  "Buffer days are the days between completing your final week of dosing and your next clinic appointment. " +
  "Your program requires at least 7 days on the final week's dose before your visit. " +
  "Buffer days show how much cushion you have — so you know you're on track. " +
  "Note: The day of your appointment and the day before (for travel) are not counted as buffer days."

export default function DailyView({
  schedule,
  doseState,
  onStateChange,
  onCompleteDay,
  onSkipDay,
  onSkipMorning,
  appointmentDate,
  familyName,
  completedPositions,
  dayRecords,
  treatmentAnchor,
  previousDayIncomplete,
  foodGroups,
  visitNumber,
  isAppointmentDay,
  foodProgress,
}: DailyViewProps) {
  const [infoSheetOpen, setInfoSheetOpen] = useState(false)
  const { currentWeek, currentDay, checkedFoods, floorWeek, floorDay } = doseState

  const totalTreatmentWeeks = getTotalTreatmentWeeks(schedule)

  let slowestCompletedDays = 0
  if (foodProgress.size > 0) {
    let minIdx = Infinity
    for (const fp of foodProgress.values()) {
      const idx = (fp.week - 1) * 7 + (fp.day - 1)
      if (idx < minIdx) {
        minIdx = idx
        slowestCompletedDays = fp.completedDays
      }
    }
  }

  const bufferResult = calculateBufferFromProgress(
    appointmentDate,
    totalTreatmentWeeks,
    doseState.currentWeek,
    slowestCompletedDays
  )

  const bufferDisplay =
    bufferResult.kind === "days" ? `${bufferResult.count}` :
    bufferResult.kind === "behind" ? `-${bufferResult.count}` :
    "—"

  const viewSeq = (currentWeek - 1) * 7 + currentDay
  const anchorSeq = (treatmentAnchor.week - 1) * 7 + treatmentAnchor.day
  const floorSeq = (floorWeek - 1) * 7 + floorDay
  const isFutureDay = viewSeq > anchorSeq
  const isCurrentTreatmentDay = viewSeq === anchorSeq

  const posKey = `${currentWeek}-${currentDay}`
  const record = dayRecords.get(posKey)
  const projectedDate = new Date()
  projectedDate.setDate(projectedDate.getDate() + (viewSeq - anchorSeq))
  const isSkipped = record?.skipped === true
  const dateLabel = formatDateLabel(projectedDate)
  const isToday = viewSeq === anchorSeq && !isSkipped

  // Visit ring
  const visitIdx = getVisitIndex(visitNumber)
  const visitProgress = visitIdx / 25
  const strokeDashoffset = CIRCUMFERENCE * (1 - visitProgress)

  // Appointment bubble
  const daysToAppt = getDaysToAppointment(appointmentDate)

  const leftDisabled = viewSeq <= floorSeq
  const rightDisabled = !completedPositions.has(posKey)

  function handleNavigate(delta: number) {
    onStateChange(prev => {
      let nextDay = prev.currentDay + delta
      let nextWeek = prev.currentWeek
      if (nextDay > 7) { nextWeek += 1; nextDay = 1 }
      else if (nextDay < 1) { nextWeek -= 1; nextDay = 7 }
      if (nextWeek < 1) return prev
      const nextSeq = (nextWeek - 1) * 7 + nextDay
      const fSeq = (prev.floorWeek - 1) * 7 + prev.floorDay
      if (nextSeq < fSeq) return prev
      const completedDays = { ...(prev.completedDays ?? {}), [`${prev.currentWeek}-${prev.currentDay}`]: prev.checkedFoods }
      const restored = completedDays[`${nextWeek}-${nextDay}`] ?? {}
      return { ...prev, currentWeek: nextWeek, currentDay: nextDay, checkedFoods: restored, completedDays }
    })
  }

  function handleCheck(key: string, val: boolean) {
    onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))
    if (val && key.startsWith("evening-") && !isFutureDay && schedule.treatmentFoods.length > 0) {
      const updatedChecked = { ...checkedFoods, [key]: val }
      const allEveningChecked = schedule.treatmentFoods.every(
        food => !!updatedChecked[`evening-${food.name}`]
      )
      if (allEveningChecked) onCompleteDay()
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Orange header */}
      <header style={{ background: "#ff6b35" }}>
        <div className="px-4 pt-5 pb-3 flex items-center gap-3">
          {/* Avatar with SVG progress ring */}
          <div className="relative flex-shrink-0" style={{ width: 58, height: 58 }}>
            <svg width="58" height="58" viewBox="0 0 58 58" style={{ position: "absolute", inset: 0 }}>
              <circle
                cx="29" cy="29" r="26"
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="5"
              />
              <circle
                cx="29" cy="29" r="26"
                fill="none"
                stroke="#4fc3f7"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${CIRCUMFERENCE}`}
                strokeDashoffset={`${strokeDashoffset}`}
                transform="rotate(-90 29 29)"
              />
            </svg>
            {/* Avatar inner — emoji placeholder until F2 adds photo */}
            <div
              className="absolute rounded-full flex items-center justify-center"
              style={{ inset: 6, background: "#fff3ec", fontSize: 20 }}
            >
              🧒
            </div>
          </div>

          {/* Text stack */}
          <div className="flex-1 min-w-0">
            {familyName && (
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.85)" }}>
                {familyName}&apos;s Tip Pal
              </p>
            )}
            <p className="font-semibold text-white" style={{ fontSize: 15 }}>
              {visitNumber ? `Visit ${visitNumber} · ` : ""}Week {treatmentAnchor.week}, Day {treatmentAnchor.day}
            </p>
            {daysToAppt !== null && (
              <span
                className="inline-block text-white mt-0.5"
                style={{
                  background: "rgba(255,255,255,0.20)",
                  borderRadius: 9999,
                  padding: "3px 10px",
                  fontSize: 11,
                  fontWeight: 400,
                }}
              >
                {daysToAppt} days to appointment
              </span>
            )}
          </div>
        </div>

        {/* Buffer days row */}
        <div
          className="flex items-center"
          style={{ padding: "2px 16px 12px" }}
        >
          <span style={{ fontSize: 13, fontWeight: 400, color: "rgba(255,255,255,0.85)" }}>
            Buffer days
          </span>
          <span className="ml-1" style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
            {bufferDisplay}
          </span>
          <button
            className="ml-auto flex items-center justify-center italic"
            style={{
              width: 18,
              height: 18,
              border: "1.5px solid rgba(255,255,255,0.5)",
              borderRadius: "50%",
              fontSize: 10,
              color: "#fff",
              fontFamily: "serif",
              background: "transparent",
            }}
            onClick={() => setInfoSheetOpen(true)}
            aria-label="Buffer days info"
          >
            i
          </button>
        </div>
      </header>

      {/* Day navigator strip */}
      <div
        className="flex items-center justify-between px-4"
        style={{
          background: "#fff8f5",
          borderBottom: "0.5px solid #f0ddd4",
          minHeight: 52,
        }}
      >
        <button
          onClick={() => handleNavigate(-1)}
          disabled={leftDisabled}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#fff",
            border: "0.5px solid #f0ddd4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: leftDisabled ? 0.3 : 1,
          }}
          aria-label="Previous day"
        >
          <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
            <path d="M7 1L1 6.5L7 12" stroke="#2d1a0e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <div className="text-center">
          <p className="font-medium" style={{ fontSize: 13, color: "#2d1a0e" }}>
            {isSkipped ? "Skipped" : dateLabel}
          </p>
          {isToday && (
            <p style={{ fontSize: 11, color: "#9a6a55" }}>Today</p>
          )}
        </div>

        <button
          onClick={() => handleNavigate(1)}
          disabled={rightDisabled}
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "#fff",
            border: "0.5px solid #f0ddd4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: rightDisabled ? 0.3 : 1,
          }}
          aria-label="Next day"
        >
          <svg width="8" height="13" viewBox="0 0 8 13" fill="none">
            <path d="M1 1L7 6.5L1 12" stroke="#2d1a0e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 pt-4 pb-24">
        {previousDayIncomplete && isCurrentTreatmentDay && (
          <div
            className="mb-4 px-4 py-3 rounded-xl"
            style={{ background: "#fff8e1", border: "0.5px solid #ffe082" }}
          >
            <p className="text-sm font-medium" style={{ color: "#795548" }}>
              Yesterday wasn&apos;t completed — you can still check off today&apos;s foods.
            </p>
          </div>
        )}

        {isAppointmentDay && isCurrentTreatmentDay ? (
          <div
            className="rounded-xl px-4 py-6 mb-4 flex flex-col gap-3"
            style={{ background: "#e8f4fd", border: "0.5px solid #bdddf5" }}
          >
            <div>
              <p className="text-base font-semibold" style={{ color: "#1a5276" }}>
                {visitNumber ? `Today is Visit ${visitNumber}.` : "Today is your appointment."}
              </p>
              <p className="text-sm mt-1" style={{ color: "#2980b9" }}>
                When you&apos;re ready, start your new food cycle to load your updated schedule.
              </p>
            </div>
            <Link
              href="/new-cycle"
              className="block text-center w-full py-3 text-white text-sm font-semibold rounded-[16px]"
              style={{ background: "#ff6b35" }}
            >
              Start new food cycle
            </Link>
          </div>
        ) : (
          <>
            <MorningSection
              schedule={schedule}
              currentDay={currentDay}
              checkedFoods={checkedFoods}
              onCheck={handleCheck}
              isFutureDay={isFutureDay}
              foodGroups={foodGroups}
            />
            <EveningSection
              schedule={schedule}
              currentWeek={currentWeek}
              checkedFoods={checkedFoods}
              onCheck={handleCheck}
              onSkipDay={onSkipDay}
              onSkipMorning={onSkipMorning}
              onCompleteDay={onCompleteDay}
              isFutureDay={isFutureDay}
              isCurrentTreatmentDay={isCurrentTreatmentDay}
              isSkipped={isSkipped}
              foodProgress={foodProgress}
            />
          </>
        )}
      </div>

      {/* ⓘ info sheet overlay */}
      {infoSheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: "rgba(0,0,0,0.3)" }}
          onClick={() => setInfoSheetOpen(false)}
        >
          <div
            className="w-full mx-auto rounded-t-2xl px-6 pt-6 pb-10 shadow-xl"
            style={{ maxWidth: 430, background: "#fff" }}
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm leading-relaxed" style={{ color: "#4a3728" }}>
              {BUFFER_INFO_COPY}
            </p>
            <button
              className="mt-5 w-full py-3 rounded-xl text-sm font-medium"
              style={{ background: "#f5efe9", color: "#2d1a0e" }}
              onClick={() => setInfoSheetOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Update `app/daily/page.tsx` — remove appointment editing, add skip morning**

Make the following precise changes to `app/daily/page.tsx`:

**4a. Add `saveSkipMorning` to the supabase import line.** (Note: `saveSkipMorning` is added in Task 3 but Task 1 wires the call. Add the import now so Task 3 implements it — TypeScript will error until Task 3 adds the export, but that's expected.)

Actually — `saveSkipMorning` doesn't exist until Task 3. Reverse: only wire `handleSkipMorning` in page.tsx during Task 3. In this step, just:

**4a. Remove `handleAppointmentChange` function.** Delete these lines:
```ts
const appointmentDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

function handleAppointmentChange(value: string) {
  const normalized = value.trim() === "" ? null : value
  setAppointmentDate(normalized)
  if (appointmentDebounceRef.current) clearTimeout(appointmentDebounceRef.current)
  appointmentDebounceRef.current = setTimeout(async () => {
    try {
      await saveAppointmentDate(normalized)
    } catch {
      // Save failed silently — server state wins on next refresh.
    }
  }, 300)
}
```

**4b. Remove `saveAppointmentDate` from the import** if it's only used by `handleAppointmentChange`. (Check if it's also used elsewhere — if not, remove it from the `@/lib/supabase` import.)

**4c. Update the `<DailyView>` render call.** Remove the `onAppointmentChange` prop line:
```tsx
// REMOVE this line:
onAppointmentChange={handleAppointmentChange}
```

Add `onSkipMorning` with a no-op stub for now (Task 3 will replace the no-op):
```tsx
onSkipMorning={() => {}}
```

The DailyView render should now look like:
```tsx
return (
  <DailyView
    schedule={schedule}
    doseState={doseState}
    onStateChange={handleStateChange}
    onCompleteDay={handleCompleteDay}
    onSkipDay={handleSkipDay}
    onSkipMorning={() => {}}
    appointmentDate={appointmentDate}
    familyName={familyName}
    completedPositions={completedPositions}
    dayRecords={dayRecords}
    treatmentAnchor={treatmentAnchor}
    previousDayIncomplete={previousDayIncomplete}
    foodGroups={foodGroups}
    visitNumber={visitNumber}
    isAppointmentDay={isAppointmentDay}
    foodProgress={foodProgress}
  />
)
```

- [ ] **Step 5: Run build to verify Task 1**

```bash
cd /Users/dan/Shipyard/tippal && npm run build 2>&1 | tail -30
```
Expected: `✓ Compiled successfully` or `Route (app) ...` table with no TypeScript errors. Fix any type errors before proceeding.

- [ ] **Step 6: Commit Task 1**

```bash
git add lib/schedule.ts components/DailyView.tsx app/daily/page.tsx
git commit -m "feat(f1): rebuild DailyView header, buffer row, day navigator; add schedule helpers"
```

---

### Task 2: Food Primitives Redesign

**Context:** The F0 build created `FoodCard`, `CheckCircle`, `Badge`, `SectionHeader`, and `CTAButton` in `components/ui/`. Task 1 has already shipped. This task redesigns `FoodItem` and `FoodGroupRow` to use those primitives. No behavior changes — only visual/rendering changes.

**Files:**
- Modify: `components/ui/FoodCard.tsx`
- Modify: `components/ui/CheckCircle.tsx`
- Modify: `components/FoodItem.tsx`
- Modify: `components/FoodGroupRow.tsx`

**Interfaces:**
- Consumes: `FoodCard`, `CheckCircle`, `Badge` from `components/ui/` (already exist from F0)
- Produces for Task 3:
  - `FoodItem` with new `session: "morning" | "evening" | "med"` prop — renders FoodCard + CheckCircle
  - `FoodGroupRow` with partial state visual treatment

- [ ] **Step 1: Add `partial` prop to `components/ui/FoodCard.tsx`**

Replace the entire file:

```tsx
interface FoodCardProps {
  children: React.ReactNode
  checked: boolean
  session: "morning" | "evening" | "med"
  partial?: boolean
}

const SESSION_CHECKED_STYLES = {
  morning: "bg-[#fff8f5]",
  evening: "bg-[#faf8ff]",
  med: "bg-[#faf8ff]",
}

const SESSION_CHECKED_BORDER_COLOR = {
  morning: "#ffb899",
  evening: "#c4a8f0",
  med: "#e8dff5",
}

export default function FoodCard({ children, checked, session, partial }: FoodCardProps) {
  const partialStyle: React.CSSProperties = {
    borderWidth: "1.5px",
    borderStyle: "dashed",
    borderColor: "#ff6b35",
  }
  const checkedStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: SESSION_CHECKED_BORDER_COLOR[session],
  }
  const defaultStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: "#f0ddd4",
  }

  const inlineStyle = partial ? partialStyle : checked ? checkedStyle : defaultStyle
  const bgClass = partial ? "bg-white" : checked ? SESSION_CHECKED_STYLES[session] : "bg-white"

  return (
    <div
      className={`rounded-[14px] px-3 py-[10px] mb-[7px] transition-colors ${bgClass}`}
      style={inlineStyle}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Add `partial` prop to `components/ui/CheckCircle.tsx`**

Replace the entire file:

```tsx
interface CheckCircleProps {
  checked: boolean
  session: "morning" | "evening" | "med"
  partial?: boolean
  size?: number
  onClick?: () => void
  disabled?: boolean
}

const SESSION_STYLES = {
  morning: {
    unchecked: { border: "2px solid #e8cfc4" },
    checked: { background: "#ff6b35", border: "2px solid #ff6b35" },
    partial: { border: "2px dashed #ff6b35", background: "transparent" },
  },
  evening: {
    unchecked: { border: "2px solid #d4bef0" },
    checked: { background: "#9b6fd4", border: "2px solid #9b6fd4" },
    partial: { border: "2px dashed #9b6fd4", background: "transparent" },
  },
  med: {
    unchecked: { border: "2px solid #d4bef0" },
    checked: { background: "#9b6fd4", border: "2px solid #9b6fd4" },
    partial: { border: "2px dashed #9b6fd4", background: "transparent" },
  },
}

export default function CheckCircle({
  checked,
  session,
  partial = false,
  size = 22,
  onClick,
  disabled = false,
}: CheckCircleProps) {
  const styles = SESSION_STYLES[session]
  const styleObj = partial ? styles.partial : checked ? styles.checked : styles.unchecked

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, ...styleObj }}
      className="flex items-center justify-center transition-colors disabled:opacity-50"
      aria-pressed={checked}
    >
      {checked && !partial && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 10" fill="none">
          <path
            d="M1 5l3.5 3.5L11 1"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  )
}
```

- [ ] **Step 3: Redesign `components/FoodItem.tsx`**

Replace the entire file. The `session` prop is now required. Existing callers in MorningSection and EveningSection will be updated in Task 3 to pass `session`. FoodGroupRow sub-items also use this and are updated in Step 4 below.

```tsx
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
                fontSize: 13,
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
          <p style={{ fontSize: 11, color: "#9a6a55", marginTop: 1 }}>
            {dose} {unit}
            {prepNote ? ` · ${prepNote}` : ""}
          </p>
        </div>
      </div>
    </FoodCard>
  )
}
```

Note: `dose` is typed as `number | string` to allow medications that have non-numeric doses (e.g. "2 puffs"). Existing callers with numeric dose still work. Medication callers may pass a string.

- [ ] **Step 4: Redesign `components/FoodGroupRow.tsx`**

Replace the entire file. Uses FoodCard (with `partial` prop) and CheckCircle (with `partial` prop). Chevron is on the right side, independent from the checkbox. Sub-items use 16px CheckCircle circles.

```tsx
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
                color: allChecked ? "#c4927a" : "#2d1a0e",
                textDecoration: allChecked ? "line-through" : "none",
              }}
            >
              {group.name}
            </span>
            <p
              className="truncate"
              style={{ fontSize: 11, color: "#9a6a55", marginTop: 1 }}
            >
              {memberLabel}
            </p>
          </div>
          {/* Chevron — independent from checkbox */}
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="flex items-center justify-center ml-1 flex-shrink-0"
            style={{ width: 28, height: 28, color: "#c4927a" }}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path
                d={expanded ? "M1 5L5 1L9 5" : "M1 1L5 5L9 1"}
                stroke="#c4927a"
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
                style={{ borderBottom: "0.5px solid #f0ddd4" }}
              >
                <CheckCircle
                  checked={isChecked}
                  session="morning"
                  size={16}
                  onClick={() => !disabled && onCheck(key, !isChecked)}
                  disabled={disabled}
                />
                <div className="flex-1 min-w-0">
                  <span style={{ fontSize: 12, color: isChecked ? "#c4927a" : "#2d1a0e", textDecoration: isChecked ? "line-through" : "none" }}>
                    {food.name}
                  </span>
                  <p style={{ fontSize: 11, color: "#9a6a55" }}>
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
```

- [ ] **Step 5: Run build to verify Task 2**

```bash
cd /Users/dan/Shipyard/tippal && npm run build 2>&1 | tail -30
```

Expected: Build succeeds. If MorningSection/EveningSection complain about missing `session` prop on FoodItem — that's expected and will be fixed in Task 3.

- [ ] **Step 6: Commit Task 2**

```bash
git add components/ui/FoodCard.tsx components/ui/CheckCircle.tsx components/FoodItem.tsx components/FoodGroupRow.tsx
git commit -m "feat(f1): redesign food card primitives — FoodItem uses FoodCard+CheckCircle, group partial state"
```

---

### Task 3: Morning + Evening Sections + Medications + Skip Links

**Context:** Tasks 1 and 2 are complete. DailyView has the new header/navigator. FoodItem now requires a `session` prop. This task:
1. Updates MorningSection to pass `session="morning"` and add medication cards
2. Rebuilds EveningSection to pass `session="evening"`, add medication cards, persistent Complete Day button, Skip morning (log only) + Skip evening (position freeze) links
3. Adds `saveSkipMorning` to `lib/supabase.ts`
4. Wires `handleSkipMorning` in `app/daily/page.tsx` (replaces the `() => {}` stub from Task 1)

**Files:**
- Modify: `components/MorningSection.tsx`
- Modify: `components/EveningSection.tsx`
- Modify: `lib/supabase.ts`
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes from Task 1:
  - `getMedicationSessions(frequency: string): ("morning" | "evening")[]` — import from `@/lib/schedule`
  - `getVisitIndex` — already imported by DailyView, not needed here
- Consumes from Task 2:
  - `FoodItem` with `session: "morning" | "evening" | "med"` prop
- Consumes from `@/lib/types`: `Medication` (interface: `{ name: string; dose: string; unit: string; frequency: string }`)
- Consumes from existing supabase.ts: existing `saveDoseLog`, `saveSkipDay` patterns for reference when adding `saveSkipMorning`

- [ ] **Step 1: Update `components/MorningSection.tsx`**

Replace the entire file. Changes from the old version:
- Pass `session="morning"` to FoodItem
- After food items, render morning medications using `session="med"` FoodItem
- SectionHeader count includes morning medications
- Import `getMedicationSessions` from `@/lib/schedule`

```tsx
"use client"

import { ParsedSchedule, FoodGroup, MaintenanceFood, WeeklyFood, Medication } from "@/lib/types"
import { getMedicationSessions } from "@/lib/schedule"
import FoodItem from "./FoodItem"
import FoodGroupRow from "./FoodGroupRow"
import SectionHeader from "./ui/SectionHeader"

interface MorningSectionProps {
  schedule: ParsedSchedule
  currentDay: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  isFutureDay: boolean
  foodGroups: FoodGroup[]
}

type MorningItem =
  | { type: "standalone"; food: MaintenanceFood; prefix: "morning" }
  | { type: "weekly"; food: WeeklyFood; prefix: "morning-weekly" }
  | { type: "group"; group: FoodGroup; foods: Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }> }

function buildMorningItems(
  maintenanceFoods: MaintenanceFood[],
  weeklyFoods: WeeklyFood[],
  showWeekly: boolean,
  groups: FoodGroup[]
): MorningItem[] {
  const foodToGroup = new Map<string, FoodGroup>()
  for (const group of groups) {
    for (const name of group.foodNames) foodToGroup.set(name, group)
  }

  const groupFoodsMap = new Map<string, Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }>>()
  const emittedGroups = new Set<string>()

  function getGroupFoods(group: FoodGroup) {
    if (groupFoodsMap.has(group.id)) return groupFoodsMap.get(group.id)!
    const result: Array<{ food: MaintenanceFood | WeeklyFood; prefix: "morning" | "morning-weekly" }> = []
    for (const food of maintenanceFoods) {
      if (group.foodNames.includes(food.name)) result.push({ food, prefix: "morning" })
    }
    if (showWeekly) {
      for (const food of weeklyFoods) {
        if (group.foodNames.includes(food.name)) result.push({ food, prefix: "morning-weekly" })
      }
    }
    groupFoodsMap.set(group.id, result)
    return result
  }

  const items: MorningItem[] = []

  for (const food of maintenanceFoods) {
    const group = foodToGroup.get(food.name)
    if (group) {
      if (!emittedGroups.has(group.id)) {
        emittedGroups.add(group.id)
        const foods = getGroupFoods(group)
        if (foods.length > 0) items.push({ type: "group", group, foods })
      }
    } else {
      items.push({ type: "standalone", food, prefix: "morning" })
    }
  }

  if (showWeekly) {
    for (const food of weeklyFoods) {
      const group = foodToGroup.get(food.name)
      if (group) {
        if (!emittedGroups.has(group.id)) {
          emittedGroups.add(group.id)
          const foods = getGroupFoods(group)
          if (foods.length > 0) items.push({ type: "group", group, foods })
        }
      } else {
        items.push({ type: "weekly", food, prefix: "morning-weekly" })
      }
    }
  }

  return items
}

function getMorningMedications(medications: Medication[] | undefined): Medication[] {
  if (!medications?.length) return []
  return medications.filter(med => getMedicationSessions(med.frequency).includes("morning"))
}

export default function MorningSection({
  schedule,
  currentDay,
  checkedFoods,
  onCheck,
  isFutureDay,
  foodGroups,
}: MorningSectionProps) {
  const showWeekly = currentDay === 7
  const items = buildMorningItems(
    schedule.maintenanceFoods,
    schedule.weeklyFoods,
    showWeekly,
    foodGroups
  )
  const morningMeds = getMorningMedications(schedule.medications)

  // Count: all food items (groups count as 1) + medications
  const itemCount = items.length + morningMeds.length

  return (
    <section className="mb-5">
      <SectionHeader session="morning" label="Morning" count={itemCount} />
      <div>
        {items.map(item => {
          if (item.type === "group") {
            return (
              <FoodGroupRow
                key={`group-${item.group.id}`}
                group={item.group}
                foods={item.foods}
                checkedFoods={checkedFoods}
                disabled={isFutureDay}
                onCheck={onCheck}
              />
            )
          }
          const isWeekly = item.type === "weekly"
          const key = `${item.prefix}-${item.food.name}`
          return (
            <FoodItem
              key={key}
              name={item.food.name}
              dose={item.food.dose}
              unit={item.food.unit}
              prepNote={item.food.prepNote ?? null}
              capped={"capped" in item.food ? item.food.capped : false}
              session="morning"
              isWeekly={isWeekly}
              isContinuing={false}
              checked={!!checkedFoods[key]}
              disabled={isFutureDay}
              onChange={val => onCheck(key, val)}
            />
          )
        })}
        {morningMeds.map(med => {
          const key = `morning-med-${med.name}`
          return (
            <FoodItem
              key={key}
              name={med.name}
              dose={med.dose}
              unit={med.unit}
              prepNote={null}
              capped={false}
              session="med"
              checked={!!checkedFoods[key]}
              disabled={isFutureDay}
              onChange={val => onCheck(key, val)}
            />
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Rebuild `components/EveningSection.tsx`**

Replace the entire file. Changes from the old version:
- Pass `session="evening"` to FoodItem for treatment foods
- Add evening medication cards (`session="med"`)
- Complete Day button: always visible, disabled (via CTAButton `disabled` prop) until all evening treatment foods are checked
- Skip evening link: "Skip evening" (existing position-freeze Skip Day behavior)
- Skip morning link: "Skip morning" (informational — calls `onSkipMorning`)
- Both skip links show only when `isCurrentTreatmentDay && !isFutureDay && !isSkipped`
- Skip evening additionally gated by `!allChecked` (can't skip when complete)
- `onSkipMorning` is a new prop

```tsx
"use client"

import { useState } from "react"
import { ParsedSchedule, FoodProgress, Medication } from "@/lib/types"
import { getMedicationSessions, getTreatmentFoodEntry, foodsAreInSync } from "@/lib/schedule"
import FoodItem from "./FoodItem"
import SectionHeader from "./ui/SectionHeader"
import CTAButton from "./ui/CTAButton"

interface EveningSectionProps {
  schedule: ParsedSchedule
  currentWeek: number
  checkedFoods: Record<string, boolean>
  onCheck: (key: string, val: boolean) => void
  onSkipDay: () => void
  onSkipMorning: () => void
  onCompleteDay: () => void
  isFutureDay: boolean
  isCurrentTreatmentDay: boolean
  isSkipped: boolean
  foodProgress: Map<string, FoodProgress>
}

function getEveningMedications(medications: Medication[] | undefined): Medication[] {
  if (!medications?.length) return []
  return medications.filter(med => getMedicationSessions(med.frequency).includes("evening"))
}

export default function EveningSection({
  schedule,
  currentWeek,
  checkedFoods,
  onCheck,
  onSkipDay,
  onSkipMorning,
  onCompleteDay,
  isFutureDay,
  isCurrentTreatmentDay,
  isSkipped,
  foodProgress,
}: EveningSectionProps) {
  const [confirmingSkip, setConfirmingSkip] = useState(false)

  const inSync = foodsAreInSync(foodProgress)
  const treatmentFoods = schedule.treatmentFoods
  const eveningMeds = getEveningMedications(schedule.medications)

  const allTreatmentChecked =
    treatmentFoods.length > 0 &&
    treatmentFoods.every(food => !!checkedFoods[`evening-${food.name}`])

  // Count: treatment foods + medications
  const itemCount = treatmentFoods.length + eveningMeds.length

  const showActions = isCurrentTreatmentDay && !isFutureDay && !isSkipped

  return (
    <section className="mb-6">
      <SectionHeader session="evening" label="Evening" count={itemCount} />

      {isFutureDay ? (
        <div
          className="px-4 py-3 rounded-xl"
          style={{ background: "#fff8e1", border: "0.5px solid #ffe082" }}
        >
          <p className="text-sm font-medium" style={{ color: "#795548" }}>
            You haven&apos;t reached this treatment day yet
          </p>
        </div>
      ) : (
        <>
          {/* Treatment foods */}
          {treatmentFoods.map(food => {
            const fp = foodProgress.get(food.name)
            const foodWeek = fp?.week ?? currentWeek
            const { weekEntry, isContinuing } = getTreatmentFoodEntry(food, foodWeek)
            const weekBadge = !inSync && fp ? `Wk ${fp.week} · Day ${fp.day}` : undefined
            const key = `evening-${food.name}`
            return (
              <FoodItem
                key={key}
                name={food.name}
                dose={weekEntry.dose}
                unit={weekEntry.unit}
                prepNote={null}
                capped={false}
                session="evening"
                isContinuing={isContinuing}
                checked={!!checkedFoods[key]}
                onChange={val => onCheck(key, val)}
                weekBadge={weekBadge}
              />
            )
          })}

          {/* Evening medications */}
          {eveningMeds.map(med => {
            const key = `evening-med-${med.name}`
            return (
              <FoodItem
                key={key}
                name={med.name}
                dose={med.dose}
                unit={med.unit}
                prepNote={null}
                capped={false}
                session="med"
                checked={!!checkedFoods[key]}
                onChange={val => onCheck(key, val)}
              />
            )
          })}

          {/* Complete Day — always visible; disabled until all treatment foods checked */}
          {showActions && (
            <div className="mt-4">
              <CTAButton
                disabled={!allTreatmentChecked}
                onClick={onCompleteDay}
              >
                Complete Day
              </CTAButton>
            </div>
          )}

          {/* Skip links */}
          {showActions && (
            <div className="mt-3 flex flex-col items-center gap-1">
              {/* Skip evening — position freeze; only when not all checked */}
              {!allTreatmentChecked && !confirmingSkip && (
                <button
                  className="text-sm underline"
                  style={{ color: "#c4927a" }}
                  onClick={() => setConfirmingSkip(true)}
                >
                  Skip evening
                </button>
              )}
              {confirmingSkip && (
                <div
                  className="w-full px-4 py-3 rounded-xl"
                  style={{ background: "#f5efe9", border: "0.5px solid #f0ddd4" }}
                >
                  <p className="text-sm font-medium mb-3" style={{ color: "#2d1a0e" }}>
                    Skip this day? Tomorrow will repeat the same week and day. This can&apos;t be undone.
                  </p>
                  <div className="flex gap-3">
                    <button
                      className="flex-1 py-2 text-sm font-semibold rounded-lg"
                      style={{ background: "#ff6b35", color: "#fff" }}
                      onClick={() => { setConfirmingSkip(false); onSkipDay() }}
                    >
                      Yes — skip
                    </button>
                    <button
                      className="flex-1 py-2 text-sm font-semibold rounded-lg"
                      style={{ background: "#f0ddd4", color: "#2d1a0e" }}
                      onClick={() => setConfirmingSkip(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {/* Skip morning — informational log only */}
              <button
                className="text-sm underline"
                style={{ color: "#c4927a" }}
                onClick={onSkipMorning}
              >
                Skip morning
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 3: Add `saveSkipMorning` to `lib/supabase.ts`**

Find the `saveSkipDay` function and add `saveSkipMorning` immediately after it. The function writes a dose_log row with `session: 'morning', is_skipped: true` — no position state change.

Read the existing `saveSkipDay` function for the pattern (it writes to dose_log via upsert on `family_id, week, day, session`). Then add:

```ts
export async function saveSkipMorning(week: number, day: number): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  const { data: profile } = await supabase
    .from("profiles")
    .select("family_id")
    .eq("id", user.id)
    .single()
  if (!profile) throw new Error("Profile not found")

  await supabase.from("dose_log").upsert(
    {
      family_id: profile.family_id,
      week,
      day,
      session: "morning",
      is_skipped: true,
      checked_foods: {},
      completed_at: new Date().toISOString(),
    },
    { onConflict: "family_id,week,day,session" }
  )
}
```

- [ ] **Step 4: Wire `handleSkipMorning` in `app/daily/page.tsx`**

**4a.** Add `saveSkipMorning` to the import from `@/lib/supabase`:
```ts
import {
  // ...existing imports...
  saveSkipMorning,
} from "@/lib/supabase"
```

**4b.** Add the `handleSkipMorning` function after `handleSkipDay` in page.tsx:
```ts
async function handleSkipMorning() {
  if (!hydrated || !treatmentAnchor) return
  const { week, day } = treatmentAnchor
  try {
    await saveSkipMorning(week, day)
  } catch {
    // Silent — informational log, failure is non-critical
  }
}
```

**4c.** Replace the `onSkipMorning={() => {}}` stub in the DailyView render with the real handler:
```tsx
onSkipMorning={handleSkipMorning}
```

- [ ] **Step 5: Run build to verify Task 3**

```bash
cd /Users/dan/Shipyard/tippal && npm run build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully`. Fix any TypeScript errors before proceeding. Common issues:
- `session` prop missing on FoodItem — ensure every FoodItem call has `session="morning"`, `session="evening"`, or `session="med"`
- `getMedicationSessions` not found — ensure it's exported from `lib/schedule.ts` (added in Task 1)
- `saveSkipMorning` not found — verify it was added to `lib/supabase.ts` in Step 3

- [ ] **Step 6: Commit Task 3**

```bash
git add components/MorningSection.tsx components/EveningSection.tsx lib/supabase.ts app/daily/page.tsx
git commit -m "feat(f1): add morning/evening section redesign with medication cards and skip links"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task | Status |
|---|---|---|
| Orange header with avatar ring (Visit N/25) | Task 1 | ✅ |
| Child name ("X's Tip Pal") top left | Task 1 | ✅ |
| Visit · Week · Day title | Task 1 | ✅ |
| Appointment bubble (frosted pill, "N days to appointment") | Task 1 | ✅ |
| Buffer days row: label + bold number + ⓘ button | Task 1 | ✅ |
| ⓘ tap → sheet with buffer explanation text | Task 1 | ✅ |
| Day navigator: left/right chevrons, date label + "Today" sub | Task 1 | ✅ |
| Right chevron disabled on current unlogged day | Task 1 | ✅ |
| Morning section: ☀️ icon, "MORNING" label, count | Task 3 (uses F0 SectionHeader) | ✅ |
| Orange check circles (morning) | Task 2 (FoodItem + CheckCircle) | ✅ |
| CAPPED badge | Task 2 (FoodItem uses Badge) | ✅ |
| Crush/chop note inline on dose line | Task 2 (prepNote rendered as "· note" in dose line) | ✅ |
| Evening section: 🌙 icon, "EVENING" label, count | Task 3 (uses F0 SectionHeader) | ✅ |
| Purple check circles (evening) | Task 2 | ✅ |
| Week badge per food — hidden when in sync | Task 3 (re-uses F3 logic) | ✅ |
| Medications inline in AM and/or PM list | Task 3 | ✅ |
| Medication cards: border #e8dff5, check #9b6fd4, card bg #faf8ff | Task 2 (FoodCard med session) | ✅ |
| No CAPPED badge, no week badge on medication cards | Task 3 (FoodItem with capped=false, no weekBadge) | ✅ |
| Group food cards: checkbox completes all | Task 2 (FoodGroupRow handleGroupCheck) | ✅ |
| Group food cards: chevron expands/collapses only | Task 2 (FoodGroupRow independent chevron) | ✅ |
| Group food cards: partial = dashed border + dashed circle | Task 2 (FoodCard partial + CheckCircle partial) | ✅ |
| Group food cards: no auto-expand on checkbox tap | Task 2 (checkbox and chevron are separate buttons) | ✅ |
| Complete Day button: always visible, disabled until all treatment foods checked | Task 3 (CTAButton disabled={!allTreatmentChecked}) | ✅ |
| Skip evening link (position freeze) | Task 3 | ✅ |
| Skip morning link (informational log) | Task 3 | ✅ |
| Bottom nav: Today tab active | F0 (already in layout) | ✅ |
| Appointment date read-only in header (no date input on daily view) | Task 1 (input removed) | ✅ |
| Per-food week/day advancement (F3 logic) | Unchanged — not in scope for F1 | ✅ |

**Placeholder scan:** None found.

**Type consistency check:**
- `getMedicationSessions` defined in Task 1 (lib/schedule.ts), used in Task 3 (MorningSection, EveningSection) ✅
- `FoodItem` `session` prop defined in Task 2, used in Task 3 ✅
- `FoodCard` `partial` prop defined in Task 2, used in Task 2 (FoodGroupRow) ✅
- `CheckCircle` `partial` prop defined in Task 2, used in Task 2 (FoodGroupRow) ✅
- `saveSkipMorning` defined in Task 3 Step 3, imported in Task 3 Step 4 ✅
- `onSkipMorning: () => void` on DailyViewProps (Task 1) matches prop on EveningSection (Task 3) ✅
- `EveningSection` `onSkipMorning` prop added in Task 3; `DailyView` passes it in Task 1 ✅
- `getVisitIndex` defined in Task 1 (lib/schedule.ts), used in Task 1 (DailyView.tsx) ✅

**Gap check:**
- FoodItem `dose` typed as `number | string` — medications use string dose ("2 puffs"). Existing callers pass numeric dose, which TypeScript accepts as `number | string`. ✅
- `Medication` type from `@/lib/types` has `dose: string` — consistent with FoodItem's `dose: number | string`. ✅
- `saveSkipDay` uses upsert with `onConflict: "family_id,week,day,session"` — `saveSkipMorning` follows the same pattern. ✅
- Auto-complete in `handleCheck` (in DailyView) triggers on all-evening-treatment-foods-checked. Medication checks do NOT trigger auto-complete (only evening treatment foods gate complete day). This is correct since the auto-complete check is `key.startsWith("evening-")` AND `schedule.treatmentFoods.every(food => !!updatedChecked[`evening-${food.name}`])` — medication keys are `evening-med-{name}` which starts with "evening-" but the treatment food check only iterates `schedule.treatmentFoods`, not medications. This is correct. ✅
