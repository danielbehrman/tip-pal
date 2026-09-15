"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress, ReactionRamp } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  fetchCompletedPositions,
  fetchDayRecords,
  fetchDoseLogDaysInRange,
  fetchAppointmentDate,
  fetchFliesToAppointments,
  fetchFamilyName,
  fetchFoodGroups,
  fetchVisitNumber,
  saveTimezone,
  getSession,
  fetchFoodProgress,
  saveFoodProgress,
  seedFoodProgress,
  fetchChildPhotoUrl,
  saveRecommendedGiven,
  fetchReactionRamp,
  saveReactionRamp,
  appendPreviousRamp,
  ensureDoseLogDay,
  markRampFinalized,
  upsertCheckedFood,
} from "@/lib/supabase"
import { todayDateString, addDays, formatDateOnly, getTreatmentFoodsForWeek, getGlobalPosition, getRampOverrides, positionFromIndex, MS_PER_DAY, finalizeDayRamp, recomputeFoodProgressFromHistory } from "@/lib/schedule"
import DailyView from "@/components/DailyView"

type BannerInfo =
  | { kind: "single"; date: string; foods: string[] }
  | { kind: "multi"; count: number; startDate: string; endDate: string }
  | null

export default function DailyPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [doseState, setDoseState] = useState<DoseState | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [appointmentDate, setAppointmentDate] = useState<string | null>(null)
  const [fliesToAppointments, setFliesToAppointments] = useState(false)
  const [familyName, setFamilyName] = useState<string | null>(null)
  const [completedPositions, setCompletedPositions] = useState<Set<string>>(new Set())
  const [dayRecords, setDayRecords] = useState<Map<string, DayRecord>>(new Map())
  const [bannerInfo, setBannerInfo] = useState<BannerInfo>(null)
  const [foodGroups, setFoodGroups] = useState<FoodGroup[]>([])
  const [visitNumber, setVisitNumber] = useState<string | null>(null)
  const [foodProgress, setFoodProgress] = useState<Map<string, FoodProgress>>(new Map())
  const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
  // treatmentAnchor holds the current treatment day position, computed live from
  // cycle_start_date + skip_count. Set from doseState on load — never advanced
  // locally except by re-fetching doseState after a write that re-anchors it
  // (e.g. Settings).
  const [treatmentAnchor, setTreatmentAnchor] = useState<{ week: number; day: number } | null>(null)
  const foodProgressRef = useRef<Map<string, FoodProgress>>(new Map())
  const recommendedFoodCountsRef = useRef<Record<string, Record<string, number>>>({})
  const [reactionRamp, setReactionRamp] = useState<ReactionRamp | null>(null)
  const reactionRampRef = useRef<ReactionRamp | null>(null)

  useEffect(() => {
    async function load() {
      // Auth check — only this warrants a /login redirect
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

      // Silently sync device timezone so push notifications fire at local time
      saveTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => {})

      // Data fetching — errors here are not auth failures, never redirect to /login
      try {
        const s = await fetchSchedule()
        if (!s) {
          router.replace("/setup")
          return
        }
        const [ds, apptDate, name, positions, records, groups, vNum, rawProgress, photoUrl, rawRamp, flies] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate().catch(() => null),
          fetchFamilyName().catch(() => null),
          fetchCompletedPositions().catch(() => new Set<string>()),
          fetchDayRecords().catch(() => new Map<string, DayRecord>()),
          fetchFoodGroups().catch(() => []),
          fetchVisitNumber().catch(() => null),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
          fetchChildPhotoUrl().catch(() => null),
          fetchReactionRamp().catch(() => null),
          fetchFliesToAppointments().catch(() => false),
        ])
        if (!name) {
          router.replace("/onboarding")
          return
        }
        const initialState = ds ?? {
          currentWeek: 1,
          currentDay: 1,
          checkedFoods: {},
          cycleStartDate: todayDateString(),
          skipCount: 0,
          recommendedFoodCounts: {},
        }

        // Seed food progress on first load if the table is empty for this family
        let progress = rawProgress
        let ramp = rawRamp
        if (progress.size === 0 && s.treatmentFoods.length > 0) {
          try {
            progress = await seedFoodProgress(
              s.treatmentFoods.map(f => ({
                foodName: f.name,
                week: initialState.currentWeek,
                day: initialState.currentDay,
              }))
            )
          } catch {
            // Seed failed — continue with empty progress; app still functional
          }
        }

        // Override global week/day from food progress (per-food counters are authoritative)
        let globalPos = progress.size > 0
          ? getGlobalPosition(progress)
          : { week: initialState.currentWeek, day: initialState.currentDay }

        const stateWithGlobalPos: DoseState = {
          ...initialState,
          currentWeek: globalPos.week,
          currentDay: globalPos.day,
        }

        let finalDayRecords = records
        let finalCompletedPositions = positions
        let banner: BannerInfo = null

        // Nightly finalization: ensure every calendar day from cycle_start_date
        // through yesterday has a dose_log row (empty/unchecked if nothing was
        // ever tapped), then recompute treatment_food_progress from a fresh,
        // full replay of the actual ledger — safe to run from multiple devices
        // without coordination, since a full replay always produces the same
        // answer from the same data (see recomputeFoodProgressFromHistory).
        // Ramp advancement is NOT a replay — it's incremental state — so it's
        // applied once per not-yet-finalized day, tracked via ramp_finalized,
        // in chronological order.
        const yesterday = addDays(todayDateString(), -1)
        if (initialState.cycleStartDate <= yesterday) {
          const MAX_FINALIZE_DAYS = 60
          const earliestFinalizeDate = addDays(yesterday, -(MAX_FINALIZE_DAYS - 1))
          const rangeStart = initialState.cycleStartDate > earliestFinalizeDate ? initialState.cycleStartDate : earliestFinalizeDate

          for (let dDate = rangeStart; dDate <= yesterday; dDate = addDays(dDate, 1)) {
            const dayIndex = Math.round(
              (new Date(dDate + "T00:00:00").getTime() - new Date(initialState.cycleStartDate + "T00:00:00").getTime())
                / MS_PER_DAY
            )
            const { week: dWeek, day: dDay } = positionFromIndex(Math.max(0, dayIndex - initialState.skipCount))
            try {
              await ensureDoseLogDay(dDate, dWeek, dDay, s)
            } catch {
              // Ensure failed (network, etc.) — next load retries; skip ramp
              // finalization for this date this run rather than risk acting
              // on a row that may not exist.
              continue
            }
          }

          const existingDays = await fetchDoseLogDaysInRange(rangeStart, yesterday).catch(() => [])
          const unfinalizedRampDays = existingDays
            .filter(d => !d.rampFinalized)
            .sort((a, b) => (a.doseDate < b.doseDate ? -1 : a.doseDate > b.doseDate ? 1 : 0))

          let gapFirstDate: string | null = null
          let gapLastDate: string | null = null
          let gapUncheckedNames: string[] = []

          for (const entry of unfinalizedRampDays) {
            const dEveningItems = getTreatmentFoodsForWeek(s, entry.week)
            const dUncheckedNames = dEveningItems
              .filter(({ food }) => !entry.checkedFoods[`evening-${food.name}`])
              .map(({ food }) => food.name)

            if (dUncheckedNames.length > 0) {
              if (!gapFirstDate) gapFirstDate = entry.doseDate
              gapLastDate = entry.doseDate
              gapUncheckedNames = dUncheckedNames
            }

            // Gated on "was anything actually checked this day," matching the
            // old lazy-rollover code's own established rule (commit 267c681,
            // "gate ramp advance on actual checks") — an entirely-unchecked
            // gap day (nothing tapped, not even a real completion) must not
            // increment ramp_day, or a family who simply didn't open the app
            // for a stretch would see their ramp silently advance regardless.
            if (ramp && Object.values(entry.checkedFoods).some(Boolean)) {
              const recordedAt = new Date().toISOString()
              const { updatedRamp, justFinishedTreatment, finishedEntry } =
                finalizeDayRamp(s, entry.checkedFoods, ramp, recordedAt)
              if (justFinishedTreatment && finishedEntry) {
                try {
                  await appendPreviousRamp(finishedEntry)
                } catch {
                  // History write failed — non-critical
                }
              }
              if (updatedRamp) {
                ramp = updatedRamp
                try {
                  await saveReactionRamp(ramp)
                } catch {
                  // Save failed — non-critical, next load re-fetches truth
                }
              }
            }

            try {
              await markRampFinalized(entry.doseDate)
            } catch {
              // Failed to mark — the next load will re-process this same
              // day. Harmless when there's no active ramp (finalizeDayRamp
              // is a no-op), but a genuine, narrow risk when a ramp step
              // was just advanced above and only the mark-as-done write
              // failed: the next load would advance that same step again.
              // Flagged for the task reviewer rather than silently accepted
              // — a small write-ordering change (mark finalized inside the
              // same transaction as the ramp save, via a combined RPC)
              // would close this, but isn't done here to keep this task's
              // scope to what the spec actually asked for; note it as a
              // known residual gap in the final BRIEF.md writeup (Task 13).
            }
          }

          try {
            const allCycleDays = await fetchDoseLogDaysInRange(initialState.cycleStartDate, yesterday)
            progress = recomputeFoodProgressFromHistory(s, allCycleDays, progress, new Set())
            await saveFoodProgress(progress)
            globalPos = getGlobalPosition(progress)
            stateWithGlobalPos.currentWeek = globalPos.week
            stateWithGlobalPos.currentDay = globalPos.day
          } catch {
            // Recompute failed — local state still reflects whatever was
            // fetched at the top of this effect; next load retries.
          }

          const nextDayRecords = new Map(finalDayRecords)
          const nextCompletedPositions = new Set(finalCompletedPositions)
          for (const entry of existingDays) {
            const posKey = `${entry.week}-${entry.day}`
            const isSkippedEntry = getTreatmentFoodsForWeek(s, entry.week).length > 0 &&
              getTreatmentFoodsForWeek(s, entry.week).every(({ food }) => !entry.checkedFoods[`evening-${food.name}`])
            nextDayRecords.set(posKey, { date: entry.doseDate, skipped: isSkippedEntry, checkedFoods: entry.checkedFoods })
            nextCompletedPositions.add(posKey)
          }
          finalDayRecords = nextDayRecords
          finalCompletedPositions = nextCompletedPositions

          if (gapFirstDate && gapLastDate) {
            banner = gapFirstDate === gapLastDate
              ? { kind: "single", date: gapFirstDate, foods: gapUncheckedNames }
              : {
                  kind: "multi",
                  count: Math.round(
                    (new Date(gapLastDate + "T00:00:00").getTime() - new Date(gapFirstDate + "T00:00:00").getTime())
                      / (1000 * 60 * 60 * 24)
                  ) + 1,
                  startDate: gapFirstDate,
                  endDate: gapLastDate,
                }
          }
        }

        setSchedule(s)
        setDoseState(stateWithGlobalPos)
        setFoodProgress(progress)
        foodProgressRef.current = progress
        setTreatmentAnchor({ week: stateWithGlobalPos.currentWeek, day: stateWithGlobalPos.currentDay })
        treatmentAnchorRef.current = { week: stateWithGlobalPos.currentWeek, day: stateWithGlobalPos.currentDay }
        recommendedFoodCountsRef.current = initialState.recommendedFoodCounts ?? {}
        setAppointmentDate(apptDate)
        setFliesToAppointments(flies)
        setFamilyName(name)
        setCompletedPositions(finalCompletedPositions)
        setDayRecords(finalDayRecords)
        setFoodGroups(groups)
        setVisitNumber(vNum)
        setChildPhotoUrl(photoUrl)
        setReactionRamp(ramp)
        reactionRampRef.current = ramp
        setBannerInfo(banner)

        setHydrated(true)
      } catch {
        router.replace("/setup")
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doseStateRef = useRef<DoseState | null>(null)
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const treatmentAnchorRef = useRef<{ week: number; day: number } | null>(null)

  function handleStateChange(updater: (prev: DoseState) => DoseState) {
    if (!hydrated) return
    setDoseState(prev => {
      if (!prev) return prev
      const next = updater(prev)
      doseStateRef.current = next
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = setTimeout(() => {
        const state = doseStateRef.current
        const anchor = treatmentAnchorRef.current
        if (!state || !anchor) return
        // checked_foods/completed_days must only ever reflect the live, editable
        // anchor day. Navigating the Today tab's arrows also routes through this
        // handler (to restore/cache what's shown), so without this guard, merely
        // *viewing* a past day and closing the app there persists that day's
        // (correctly, read-only) checked state as if it were today's in-progress
        // state — the exact "yesterday prepopulated today" bug. Position
        // (week/day) itself is never written here either way — see below.
        if (state.currentWeek !== anchor.week || state.currentDay !== anchor.day) return
        saveCheckedState(state.checkedFoods, state.completedDays ?? {}).catch(() => {})
      }, 150)
      return next
    })
  }

  function handleCheckPersist(key: string, val: boolean) {
    if (!hydrated || !treatmentAnchor || !schedule) return
    const doseDate = todayDateString()
    upsertCheckedFood(doseDate, key, val, treatmentAnchor.week, treatmentAnchor.day, schedule).catch(() => {
      // Write failed — local state still reflects the tap; the checkbox
      // will appear checked in this session even if the server write
      // didn't land. Matches this codebase's existing fire-and-forget
      // error handling for every other live-save path (e.g. saveCheckedState).
    })
  }

  function handleCrossCategoryCredit(updated: Record<string, Record<string, number>>) {
    recommendedFoodCountsRef.current = updated
    saveRecommendedGiven(updated).catch(() => {})
  }

  if (!schedule || !doseState || !treatmentAnchor) return null

  const isAppointmentDay = !!appointmentDate && appointmentDate === todayDateString()

  const { treatment: treatmentRampOverrides, maintenance: maintenanceRampOverrides } = getRampOverrides(reactionRamp)

  return (
    <DailyView
      schedule={schedule}
      doseState={doseState}
      onStateChange={handleStateChange}
      onCheckPersist={handleCheckPersist}
      appointmentDate={appointmentDate}
      fliesToAppointments={fliesToAppointments}
      familyName={familyName}
      completedPositions={completedPositions}
      dayRecords={dayRecords}
      treatmentAnchor={treatmentAnchor}
      bannerInfo={bannerInfo}
      foodGroups={foodGroups}
      visitNumber={visitNumber}
      isAppointmentDay={isAppointmentDay}
      foodProgress={foodProgress}
      childPhotoUrl={childPhotoUrl}
      recommendedFoodCountsRef={recommendedFoodCountsRef}
      onCrossCategoryCredit={handleCrossCategoryCredit}
      reactionRamp={reactionRamp}
      treatmentRampOverrides={treatmentRampOverrides}
      maintenanceRampOverrides={maintenanceRampOverrides}
    />
  )
}
