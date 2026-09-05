"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress, ReactionRamp } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  saveDoseLog,
  saveSkipMorning,
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
} from "@/lib/supabase"
import { todayDateString, addDays, formatDateOnly, getTreatmentFoodsForWeek, getGlobalPosition, treatmentRampActive, getRampOverrides, advanceProgressForDay, resolveRampAfterAdvance } from "@/lib/schedule"
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
          floorWeek: 1,
          floorDay: 1,
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

        // Lazy auto-rollover: backfill every missed day between the floor and
        // yesterday (inclusive), not just the single most recent one. Each
        // missing day gets tagged with the calendar-projected position it
        // represents (today's calendar position minus however many days back
        // it is) — NOT the frozen FoodProgress position, which may not have
        // moved at all during the gap. Iterates oldest-to-newest so ramp/
        // FoodProgress state threads forward correctly, though a fully-
        // unchecked day is a no-op for both (advanceProgressForDay only
        // advances a food whose checkbox was actually checked).
        const yesterday = addDays(todayDateString(), -1)
        const yesterdaySeq = (initialState.currentWeek - 1) * 7 + initialState.currentDay - 1
        const floorSeq = (initialState.floorWeek - 1) * 7 + initialState.floorDay
        if (
          initialState.cycleStartDate < todayDateString() &&
          yesterdaySeq > floorSeq
        ) {
          // Safety cap: a real multi-month gap shouldn't silently write hundreds
          // of rows in one page load. floorSeq is the earliest index eligible for
          // backfill (matches the existing loop-entry condition above); this only
          // narrows that further for an unusually large gap.
          const MAX_BACKFILL_DAYS = 60
          const firstIdx = Math.max(floorSeq, yesterdaySeq - MAX_BACKFILL_DAYS)

          // One range fetch instead of one existence-check per day (this also
          // gives every backfilled day the same correct local-calendar-date
          // bucketing fetchDoseLogDaysInRange already uses, rather than the
          // UTC-based fetchDateHasDayRecord this replaces).
          const rangeStart = addDays(yesterday, firstIdx - (yesterdaySeq - 1))
          const existingDays = await fetchDoseLogDaysInRange(rangeStart, yesterday).catch(() => null)
          if (existingDays !== null) {
          const existingDates = new Set(existingDays.map(d => formatDateOnly(new Date(d.completedAt))))

          let gapFirstDate: string | null = null
          let gapLastDate: string | null = null
          let gapUncheckedNames: string[] = []

          for (let idx = firstIdx; idx < yesterdaySeq; idx++) {
            const dWeek = Math.floor(idx / 7) + 1
            const dDay = (idx % 7) + 1
            const dPosKey = `${dWeek}-${dDay}`
            const dDate = addDays(yesterday, idx - (yesterdaySeq - 1))

            if (existingDates.has(dDate)) continue

            const dCheckedFoods = initialState.completedDays?.[dPosKey] ?? {}
            const dEveningItems = getTreatmentFoodsForWeek(s, dWeek)
            const dUncheckedNames = dEveningItems
              .filter(({ food }) => !dCheckedFoods[`evening-${food.name}`])
              .map(({ food }) => food.name)
            const dIsSkipped = dEveningItems.length > 0 && dUncheckedNames.length === dEveningItems.length

            // dDayDate anchors this reconciled row to the calendar day it
            // represents, not to "now" — required so a later reload's range
            // fetch finds this row (idempotency) and so History shows the
            // correct date. recordedAt (when reconciliation actually ran) is
            // used only for the informational FoodProgress.lastCompletedAt field.
            const dDayDateObj = new Date(dDate + "T00:00:00")
            dDayDateObj.setHours(12, 0, 0, 0)
            const dDayDate = dDayDateObj.toISOString()
            const recordedAt = new Date().toISOString()

            const wasTreatmentRampActiveThatDay = treatmentRampActive(ramp)
            const { updatedProgress: advancedProgress, updatedRampTreatmentFoods, updatedRampMaintenanceFoods } =
              advanceProgressForDay(s, dCheckedFoods, progress, ramp, recordedAt)

            try {
              await saveDoseLog(dWeek, dDay, dCheckedFoods, dDayDate, s, dIsSkipped, ramp?.active ?? false)
              await saveFoodProgress(advancedProgress)
              progress = advancedProgress
              globalPos = getGlobalPosition(advancedProgress)
              stateWithGlobalPos.currentWeek = globalPos.week
              stateWithGlobalPos.currentDay = globalPos.day

              if (ramp && Object.values(dCheckedFoods).some(Boolean)) {
                const { nextRamp, justFinishedTreatment, fullyDone } = resolveRampAfterAdvance(
                  ramp, updatedRampTreatmentFoods, updatedRampMaintenanceFoods, wasTreatmentRampActiveThatDay
                )
                if (justFinishedTreatment) {
                  try {
                    await appendPreviousRamp({
                      startedAt: ramp.startedAt,
                      endedAt: recordedAt,
                      rampDayCount: nextRamp.rampDay,
                      treatmentFoods: nextRamp.treatmentFoods,
                      maintenanceFoods: nextRamp.maintenanceFoods,
                    })
                  } catch {
                    // History write failed — non-critical
                  }
                }
                ramp = fullyDone
                  ? { active: false, startedAt: "", rampDay: 0, startedAtWeek: 0, startedAtDay: 0, treatmentFoods: [], maintenanceFoods: [] }
                  : nextRamp
                try {
                  await saveReactionRamp(ramp)
                } catch {
                  // Save failed — non-critical, next load re-fetches truth
                }
              }

              const nextDayRecords = new Map(finalDayRecords)
              nextDayRecords.set(dPosKey, { date: dDayDate, skipped: dIsSkipped })
              finalDayRecords = nextDayRecords

              const nextCompletedPositions = new Set(finalCompletedPositions)
              nextCompletedPositions.add(dPosKey)
              finalCompletedPositions = nextCompletedPositions

              if (dUncheckedNames.length > 0) {
                if (!gapFirstDate) gapFirstDate = dDate
                gapLastDate = dDate
                gapUncheckedNames = dUncheckedNames
              }
            } catch {
              if (dUncheckedNames.length > 0 && !gapFirstDate) {
                gapFirstDate = dDate
                gapLastDate = dDate
                gapUncheckedNames = dUncheckedNames
              }
            }
          }

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
        }

        setSchedule(s)
        setDoseState(stateWithGlobalPos)
        setFoodProgress(progress)
        foodProgressRef.current = progress
        setTreatmentAnchor({ week: stateWithGlobalPos.currentWeek, day: stateWithGlobalPos.currentDay })
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

  function handleStateChange(updater: (prev: DoseState) => DoseState) {
    if (!hydrated) return
    setDoseState(prev => {
      if (!prev) return prev
      const next = updater(prev)
      doseStateRef.current = next
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
      saveDebounceRef.current = setTimeout(() => {
        if (doseStateRef.current) {
          // Only save checkboxes — position (week/day) is never written by navigation.
          // Position is derived live from cycle_start_date/skip_count (see lib/schedule.ts
          // getCalendarPosition) and written only by onboarding, Settings, and Skip Day.
          saveCheckedState(
            doseStateRef.current.checkedFoods,
            doseStateRef.current.completedDays ?? {}
          ).catch(() => {})
        }
      }, 150)
      return next
    })
  }

  function handleCrossCategoryCredit(updated: Record<string, Record<string, number>>) {
    recommendedFoodCountsRef.current = updated
    saveRecommendedGiven(updated).catch(() => {})
  }

  async function handleCompleteDay() {
    const current = doseStateRef.current
    if (!current || !hydrated) return

    const { checkedFoods } = current
    const foodProgress = foodProgressRef.current
    const completedAt = new Date().toISOString()
    const currentSchedule = schedule!

    if (foodProgress.size === 0 && currentSchedule.treatmentFoods.length > 0) return

    const ramp = reactionRampRef.current
    const wasTreatmentRampActive = treatmentRampActive(ramp)

    const { updatedProgress, updatedRampTreatmentFoods, updatedRampMaintenanceFoods } =
      advanceProgressForDay(currentSchedule, checkedFoods, foodProgress, ramp, completedAt)

    // Log uses the global position BEFORE advancement (the position just completed)
    const globalBefore = getGlobalPosition(foodProgress)

    try {
      await saveFoodProgress(updatedProgress)
    } catch {
      // Save failed — continue; local state still reflects progress
    }

    const isSkipped =
      currentSchedule.treatmentFoods.length > 0 &&
      !currentSchedule.treatmentFoods.some(food => !!checkedFoods[`evening-${food.name}`])

    try {
      await saveDoseLog(
        globalBefore.week,
        globalBefore.day,
        checkedFoods,
        completedAt,
        currentSchedule,
        isSkipped,
        ramp?.active ?? false
      )
    } catch {
      // Log failed — local state still reflects the checked foods either way
    }

    let updatedRamp: ReactionRamp | null = null
    if (ramp) {
      const { nextRamp, justFinishedTreatment, fullyDone } = resolveRampAfterAdvance(
        ramp, updatedRampTreatmentFoods, updatedRampMaintenanceFoods, wasTreatmentRampActive
      )
      if (justFinishedTreatment) {
        try {
          await appendPreviousRamp({
            startedAt: ramp.startedAt,
            endedAt: completedAt,
            rampDayCount: nextRamp.rampDay,
            treatmentFoods: nextRamp.treatmentFoods,
            maintenanceFoods: nextRamp.maintenanceFoods,
          })
        } catch {
          // History write failed — non-critical, ramp state itself still updates below
        }
      }
      updatedRamp = fullyDone
        ? { active: false, startedAt: "", rampDay: 0, startedAtWeek: 0, startedAtDay: 0, treatmentFoods: [], maintenanceFoods: [] }
        : nextRamp
      try {
        await saveReactionRamp(updatedRamp)
      } catch {
        // Save failed — local state still reflects today's advancement
      }
    }

    const newGlobal = getGlobalPosition(updatedProgress)

    setFoodProgress(updatedProgress)
    foodProgressRef.current = updatedProgress
    if (ramp) {
      setReactionRamp(updatedRamp)
      reactionRampRef.current = updatedRamp
    }
    setDoseState(prev => {
      if (!prev) return prev
      return { ...prev, currentWeek: newGlobal.week, currentDay: newGlobal.day }
    })
    setTreatmentAnchor(newGlobal)

    setCompletedPositions(prev => {
      const next = new Set(prev)
      next.add(`${globalBefore.week}-${globalBefore.day}`)
      return next
    })

    setDayRecords(prev => {
      const next = new Map(prev)
      next.set(`${globalBefore.week}-${globalBefore.day}`, { date: completedAt, skipped: false })
      return next
    })
  }

  async function handleSkipMorning() {
    if (!hydrated || !treatmentAnchor) return
    const { week, day } = treatmentAnchor
    try {
      await saveSkipMorning(week, day)
    } catch {
      // Silent — informational log, failure is non-critical
    }
  }

  if (!schedule || !doseState || !treatmentAnchor) return null

  const isAppointmentDay = !!appointmentDate && appointmentDate === todayDateString()

  const { treatment: treatmentRampOverrides, maintenance: maintenanceRampOverrides } = getRampOverrides(reactionRamp)

  return (
    <DailyView
      schedule={schedule}
      doseState={doseState}
      onStateChange={handleStateChange}
      onCompleteDay={handleCompleteDay}
      onSkipMorning={handleSkipMorning}
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
