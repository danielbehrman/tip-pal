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

export default function DailyPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [doseState, setDoseState] = useState<DoseState | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [appointmentDate, setAppointmentDate] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState<string | null>(null)
  const [completedPositions, setCompletedPositions] = useState<Set<string>>(new Set())
  const [dayRecords, setDayRecords] = useState<Map<string, DayRecord>>(new Map())
  const [previousDayIncomplete, setPreviousDayIncomplete] = useState(false)
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
        const globalPos = progress.size > 0
          ? getGlobalPosition(progress)
          : { week: initialState.currentWeek, day: initialState.currentDay }

        const stateWithGlobalPos: DoseState = {
          ...initialState,
          currentWeek: globalPos.week,
          currentDay: globalPos.day,
        }

        setSchedule(s)
        setDoseState(stateWithGlobalPos)
        setFoodProgress(progress)
        foodProgressRef.current = progress
        setTreatmentAnchor({ week: globalPos.week, day: globalPos.day })
        setAppointmentDate(apptDate)
        setFamilyName(name)
        setCompletedPositions(positions)
        setDayRecords(records)
        setFoodGroups(groups)
        setVisitNumber(vNum)
        setChildPhotoUrl(photoUrl)

        const yesterday = addDays(todayDateString(), -1)
        if (initialState.cycleStartDate < todayDateString()) {
          const hasRecord = await fetchDateHasDayRecord(yesterday).catch(() => true)
          if (!hasRecord) {
            // No dose_log record for yesterday — but it may already be fully checked
            // in the completedDays cache (e.g. via Trailing Edit before retroactive
            // auto-complete existed, or before this reconciliation existed). Treat
            // that the same as completing it now, rather than showing a stale warning.
            const yesterdaySeq = (initialState.currentWeek - 1) * 7 + initialState.currentDay - 1
            const yWeek = yesterdaySeq >= 1 ? Math.floor((yesterdaySeq - 1) / 7) + 1 : null
            const yDay = yesterdaySeq >= 1 ? ((yesterdaySeq - 1) % 7) + 1 : null
            const yPosKey = yWeek && yDay ? `${yWeek}-${yDay}` : null
            const yCheckedFoods = yPosKey ? initialState.completedDays?.[yPosKey] ?? {} : {}
            const yEveningItems = yWeek ? getTreatmentFoodsForWeek(s, yWeek) : []
            const yAllChecked = yEveningItems.length > 0 && yEveningItems.every(
              ({ food }) => !!yCheckedFoods[`evening-${food.name}`]
            )
            if (yWeek && yDay && yPosKey && yAllChecked) {
              const reconciledAt = new Date().toISOString()
              const isSkipped = yEveningItems.length > 0 && !yEveningItems.some(({ food }) => !!yCheckedFoods[`evening-${food.name}`])
              try {
                await saveDoseLog(yWeek, yDay, yCheckedFoods, reconciledAt, s, isSkipped)
                setDayRecords(prev => {
                  const next = new Map(prev)
                  next.set(yPosKey, { date: reconciledAt, skipped: false })
                  return next
                })
                setCompletedPositions(prev => {
                  const next = new Set(prev)
                  next.add(yPosKey)
                  return next
                })
              } catch {
                setPreviousDayIncomplete(true)
              }
            } else {
              setPreviousDayIncomplete(true)
            }
          }
        }

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
      previousDayIncomplete={previousDayIncomplete}
      foodGroups={foodGroups}
      visitNumber={visitNumber}
      isAppointmentDay={isAppointmentDay}
      foodProgress={foodProgress}
      childPhotoUrl={childPhotoUrl}
    />
  )
}
