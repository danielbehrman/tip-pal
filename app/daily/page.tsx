"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState, DayRecord } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  saveDoseLog,
  saveSkipDay,
  fetchCompletedPositions,
  fetchDayRecords,
  fetchDateHasDayRecord,
  fetchAppointmentDate,
  saveAppointmentDate,
  fetchFamilyName,
  saveTimezone,
  getSession,
} from "@/lib/supabase"
import { todayDateString, addDays, getTreatmentFoodsForWeek } from "@/lib/schedule"
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
  // treatmentAnchor holds the current treatment day position, computed live from
  // cycle_start_date + skip_count. Set from doseState on load — never advanced
  // locally except by re-fetching doseState after a write that re-anchors it
  // (Settings, Skip Day does NOT re-anchor — see handleSkipDay).
  const [treatmentAnchor, setTreatmentAnchor] = useState<{ week: number; day: number } | null>(null)

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
        const [ds, apptDate, name, positions, records] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate().catch(() => null),
          fetchFamilyName().catch(() => null),
          fetchCompletedPositions().catch(() => new Set<string>()),
          fetchDayRecords().catch(() => new Map<string, DayRecord>()),
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
        setSchedule(s)
        setDoseState(initialState)
        setTreatmentAnchor({ week: initialState.currentWeek, day: initialState.currentDay })
        setAppointmentDate(apptDate)
        setFamilyName(name)
        setCompletedPositions(positions)
        setDayRecords(records)

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
              try {
                await saveDoseLog(yWeek, yDay, yCheckedFoods, reconciledAt, s)
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

    const { currentWeek, currentDay, checkedFoods } = current
    const completedAt = new Date().toISOString()

    try {
      await saveDoseLog(currentWeek, currentDay, checkedFoods, completedAt, schedule!)
    } catch {
      // Log failed — local state still reflects the checked foods either way
    }

    setCompletedPositions(prev => {
      const next = new Set(prev)
      next.add(`${currentWeek}-${currentDay}`)
      return next
    })

    setDayRecords(prev => {
      const next = new Map(prev)
      next.set(`${currentWeek}-${currentDay}`, { date: completedAt, skipped: false })
      return next
    })
  }

  async function handleSkipDay() {
    const current = doseStateRef.current
    if (!current || !hydrated || !treatmentAnchor) return
    const { week, day } = treatmentAnchor
    const skippedAt = new Date().toISOString()

    try {
      await saveSkipDay(week, day)
    } catch {
      return
    }

    setDayRecords(prev => {
      const next = new Map(prev)
      next.set(`${week}-${day}`, { date: skippedAt, skipped: true })
      return next
    })
    setCompletedPositions(prev => {
      const next = new Set(prev)
      next.add(`${week}-${day}`)
      return next
    })
  }

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

  if (!schedule || !doseState || !treatmentAnchor) return null

  return (
    <DailyView
      schedule={schedule}
      doseState={doseState}
      onStateChange={handleStateChange}
      onCompleteDay={handleCompleteDay}
      onSkipDay={handleSkipDay}
      appointmentDate={appointmentDate}
      onAppointmentChange={handleAppointmentChange}
      familyName={familyName}
      completedPositions={completedPositions}
      dayRecords={dayRecords}
      treatmentAnchor={treatmentAnchor}
      previousDayIncomplete={previousDayIncomplete}
    />
  )
}
