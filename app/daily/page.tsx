"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState, DayRecord, FoodGroup, FoodProgress } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  saveDoseLog,
  saveSkipMorning,
  fetchCompletedPositions,
  fetchDayRecords,
  fetchDateHasDayRecord,
  fetchLastLoggedDate,
  fetchAppointmentDate,
  fetchFamilyName,
  fetchFoodGroups,
  fetchVisitNumber,
  saveTimezone,
  getSession,
  fetchFoodProgress,
  saveFoodProgress,
  seedFoodProgress,
  fetchChildPhotoUrl,
} from "@/lib/supabase"
import { todayDateString, addDays, getTreatmentFoodsForWeek, getGlobalPosition } from "@/lib/schedule"
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
        const [ds, apptDate, name, positions, records, groups, vNum, rawProgress, photoUrl] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate().catch(() => null),
          fetchFamilyName().catch(() => null),
          fetchCompletedPositions().catch(() => new Set<string>()),
          fetchDayRecords().catch(() => new Map<string, DayRecord>()),
          fetchFoodGroups().catch(() => []),
          fetchVisitNumber().catch(() => null),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
          fetchChildPhotoUrl().catch(() => null),
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
        }

        // Seed food progress on first load if the table is empty for this family
        let progress = rawProgress
        if (progress.size === 0 && s.treatmentFoods.length > 0) {
          try {
            progress = await seedFoodProgress(
              s.treatmentFoods,
              initialState.currentWeek,
              initialState.currentDay
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

        // Lazy auto-rollover: finalize only the single most recent missed day.
        // Skips entirely if there's no genuine prior tracked day — yesterday's
        // position falling at or before the floor set at the last reset/onboarding.
        const yesterday = addDays(todayDateString(), -1)
        const yesterdaySeq = (initialState.currentWeek - 1) * 7 + initialState.currentDay - 1
        const floorSeq = (initialState.floorWeek - 1) * 7 + initialState.floorDay
        if (initialState.cycleStartDate < todayDateString() && yesterdaySeq > floorSeq) {
          const hasRecord = await fetchDateHasDayRecord(yesterday).catch(() => true)
          if (!hasRecord) {
            const yWeek = Math.floor((yesterdaySeq - 1) / 7) + 1
            const yDay = ((yesterdaySeq - 1) % 7) + 1
            const yPosKey = `${yWeek}-${yDay}`
            const yCheckedFoods = initialState.completedDays?.[yPosKey] ?? {}
            const yEveningItems = getTreatmentFoodsForWeek(s, yWeek)
            const yUncheckedNames = yEveningItems
              .filter(({ food }) => !yCheckedFoods[`evening-${food.name}`])
              .map(({ food }) => food.name)
            const yIsSkipped = yEveningItems.length > 0 && yUncheckedNames.length === yEveningItems.length

            // dayDate anchors this reconciled row to the calendar day it represents
            // (yesterday), not to "now" — required so fetchDateHasDayRecord's
            // idempotency guard actually finds this row on a later same-day reload,
            // and so fetchLastLoggedDate/History show the correct date instead of
            // today's. recordedAt (when the reconciliation itself actually ran) is
            // used only for the informational FoodProgress.lastCompletedAt field.
            const dayDate = `${yesterday}T12:00:00.000Z`
            const recordedAt = new Date().toISOString()
            // Must be read BEFORE saveDoseLog writes yesterday's row below, or this
            // would find the row we're about to write instead of the true prior one.
            const lastLoggedBeforeThisWrite = yUncheckedNames.length > 0
              ? await fetchLastLoggedDate().catch(() => null)
              : null

            const advancedProgress = new Map(progress)
            for (const { food } of yEveningItems) {
              if (!yCheckedFoods[`evening-${food.name}`]) continue
              const fp = advancedProgress.get(food.name)
              if (!fp) continue
              const newCompletedDays = fp.completedDays + 1
              advancedProgress.set(
                food.name,
                newCompletedDays >= 7
                  ? { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: recordedAt }
                  : { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: recordedAt }
              )
            }

            try {
              await saveFoodProgress(advancedProgress)
              await saveDoseLog(yWeek, yDay, yCheckedFoods, dayDate, s, yIsSkipped)
              progress = advancedProgress
              globalPos = getGlobalPosition(advancedProgress)
              stateWithGlobalPos.currentWeek = globalPos.week
              stateWithGlobalPos.currentDay = globalPos.day

              const nextDayRecords = new Map(finalDayRecords)
              nextDayRecords.set(yPosKey, { date: dayDate, skipped: yIsSkipped })
              finalDayRecords = nextDayRecords

              const nextCompletedPositions = new Set(finalCompletedPositions)
              nextCompletedPositions.add(yPosKey)
              finalCompletedPositions = nextCompletedPositions

              if (yUncheckedNames.length > 0) {
                const gapStart = lastLoggedBeforeThisWrite ? addDays(lastLoggedBeforeThisWrite, 1) : null
                const gapEnd = addDays(yesterday, -1)
                if (gapStart && gapStart <= gapEnd) {
                  const gapDays = Math.round(
                    (new Date(gapEnd + "T00:00:00").getTime() - new Date(gapStart + "T00:00:00").getTime()) / (1000 * 60 * 60 * 24)
                  ) + 1
                  banner = { kind: "multi", count: gapDays, startDate: gapStart, endDate: gapEnd }
                } else {
                  banner = { kind: "single", date: yesterday, foods: yUncheckedNames }
                }
              }
            } catch {
              if (yUncheckedNames.length > 0) {
                banner = { kind: "single", date: yesterday, foods: yUncheckedNames }
              }
            }
          }
        }

        setSchedule(s)
        setDoseState(stateWithGlobalPos)
        setFoodProgress(progress)
        foodProgressRef.current = progress
        setTreatmentAnchor({ week: stateWithGlobalPos.currentWeek, day: stateWithGlobalPos.currentDay })
        setAppointmentDate(apptDate)
        setFamilyName(name)
        setCompletedPositions(finalCompletedPositions)
        setDayRecords(finalDayRecords)
        setFoodGroups(groups)
        setVisitNumber(vNum)
        setChildPhotoUrl(photoUrl)
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

  async function handleCompleteDay() {
    const current = doseStateRef.current
    if (!current || !hydrated) return

    const { checkedFoods } = current
    const foodProgress = foodProgressRef.current
    const completedAt = new Date().toISOString()

    // Guard: if progress is empty but foods exist, seed hasn't completed yet — bail to avoid logging 1-1
    if (foodProgress.size === 0 && schedule!.treatmentFoods.length > 0) return

    // Advance per-food progress for every checked evening treatment food
    const updatedProgress = new Map(foodProgress)
    const currentSchedule = schedule!
    for (const food of currentSchedule.treatmentFoods) {
      const key = `evening-${food.name}`
      if (!checkedFoods[key]) continue
      const fp = updatedProgress.get(food.name)
      if (!fp) continue
      const newCompletedDays = fp.completedDays + 1
      if (newCompletedDays >= 7) {
        updatedProgress.set(food.name, { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: completedAt })
      } else {
        updatedProgress.set(food.name, { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: completedAt })
      }
    }

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
      await saveDoseLog(globalBefore.week, globalBefore.day, checkedFoods, completedAt, currentSchedule, isSkipped)
    } catch {
      // Log failed — local state still reflects the checked foods either way
    }

    const newGlobal = getGlobalPosition(updatedProgress)

    setFoodProgress(updatedProgress)
    foodProgressRef.current = updatedProgress
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

  return (
    <DailyView
      schedule={schedule}
      doseState={doseState}
      onStateChange={handleStateChange}
      onCompleteDay={handleCompleteDay}
      onSkipMorning={handleSkipMorning}
      appointmentDate={appointmentDate}
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
    />
  )
}
