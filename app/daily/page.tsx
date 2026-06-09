"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveCheckedState,
  saveDoseLog,
  countCompletedDaysInWeek,
  fetchCompletedPositions,
  fetchCompletedDayDates,
  fetchAppointmentDate,
  saveAppointmentDate,
  fetchFamilyName,
  saveTimezone,
  getSession,
} from "@/lib/supabase"
import DailyView from "@/components/DailyView"

export default function DailyPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [doseState, setDoseState] = useState<DoseState | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [appointmentDate, setAppointmentDate] = useState<string | null>(null)
  const [familyName, setFamilyName] = useState<string | null>(null)
  const [completedPositions, setCompletedPositions] = useState<Set<string>>(new Set())
  const [completedDayDates, setCompletedDayDates] = useState<Map<string, string>>(new Map())
  // treatmentAnchor holds the current treatment day position independently of navigation.
  // Set from doseState on load, advanced only on day completion.
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
        const [ds, apptDate, name, positions, dayDates] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate().catch(() => null),
          fetchFamilyName().catch(() => null),
          fetchCompletedPositions().catch(() => new Set<string>()),
          fetchCompletedDayDates().catch(() => new Map<string, string>()),
        ])
        if (!name) {
          router.replace("/onboarding")
          return
        }
        const initialState = ds ?? { currentWeek: 1, currentDay: 1, checkedFoods: {} }
        setSchedule(s)
        setDoseState(initialState)
        setTreatmentAnchor({ week: initialState.currentWeek, day: initialState.currentDay })
        setAppointmentDate(apptDate)
        setFamilyName(name)
        setCompletedPositions(positions)
        setCompletedDayDates(dayDates)
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
          // Position is written only by handleCompleteDay and Settings.
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

    let completedCount = 0
    try {
      await saveDoseLog(currentWeek, currentDay, checkedFoods, completedAt, schedule!)
      completedCount = await countCompletedDaysInWeek(currentWeek)
    } catch {
      // Log failed — proceed with normal day advance
    }

    const weekAdvance = completedCount >= 7
    const nextWeek = weekAdvance ? currentWeek + 1 : currentDay < 7 ? currentWeek : currentWeek + 1
    const nextDay = weekAdvance ? 1 : currentDay < 7 ? currentDay + 1 : 1

    setCompletedPositions(prev => {
      const next = new Set(prev)
      next.add(`${currentWeek}-${currentDay}`)
      return next
    })

    setCompletedDayDates(prev => {
      const next = new Map(prev)
      next.set(`${currentWeek}-${currentDay}`, completedAt)
      return next
    })

    setTreatmentAnchor({ week: nextWeek, day: nextDay })

    setDoseState(prev => {
      if (!prev) return prev
      const completedDays = {
        ...(prev.completedDays ?? {}),
        [`${currentWeek}-${currentDay}`]: checkedFoods,
      }
      const restored = completedDays[`${nextWeek}-${nextDay}`] ?? {}
      const next = { currentWeek: nextWeek, currentDay: nextDay, checkedFoods: restored, completedDays }
      doseStateRef.current = next
      saveDoseState(next).catch(() => {})
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
      appointmentDate={appointmentDate}
      onAppointmentChange={handleAppointmentChange}
      familyName={familyName}
      completedPositions={completedPositions}
      completedDayDates={completedDayDates}
      treatmentAnchor={treatmentAnchor}
    />
  )
}
