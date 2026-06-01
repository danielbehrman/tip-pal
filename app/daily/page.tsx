"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveDoseLog,
  saveSkipLog,
  countCompletedDaysInWeek,
  fetchCompletedPositions,
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
        const [ds, apptDate, name, positions] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate().catch(() => null),
          fetchFamilyName().catch(() => null),
          fetchCompletedPositions().catch(() => new Set<string>()),
        ])
        if (!name) {
          router.replace("/onboarding")
          return
        }
        setSchedule(s)
        setDoseState(ds ?? { currentWeek: 1, currentDay: 1, checkedFoods: {} })
        setAppointmentDate(apptDate)
        setFamilyName(name)
        setCompletedPositions(positions)
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
        if (doseStateRef.current) saveDoseState(doseStateRef.current).catch(() => {})
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

    setCompletedPositions(prev => {
      const next = new Set(prev)
      next.add(`${currentWeek}-${currentDay}`)
      return next
    })

    const weekAdvance = completedCount >= 7

    setDoseState(prev => {
      if (!prev) return prev
      const completedDays = {
        ...(prev.completedDays ?? {}),
        [`${prev.currentWeek}-${prev.currentDay}`]: prev.checkedFoods,
      }
      const nextWeek = weekAdvance
        ? prev.currentWeek + 1
        : prev.currentDay < 7
        ? prev.currentWeek
        : prev.currentWeek + 1
      const nextDay = weekAdvance ? 1 : prev.currentDay < 7 ? prev.currentDay + 1 : 1
      const restored = completedDays[`${nextWeek}-${nextDay}`] ?? {}
      const next = { currentWeek: nextWeek, currentDay: nextDay, checkedFoods: restored, completedDays, morningSkipped: false, eveningSkipped: false }
      doseStateRef.current = next
      saveDoseState(next).catch(() => {})
      return next
    })
  }

  async function handleSkipMorning() {
    const current = doseStateRef.current
    if (!current || !hydrated) return
    try {
      await saveSkipLog(current.currentWeek, current.currentDay, "morning")
    } catch {}
    setDoseState(prev => {
      if (!prev) return prev
      const next = { ...prev, morningSkipped: true }
      doseStateRef.current = next
      saveDoseState(next).catch(() => {})
      return next
    })
  }

  async function handleSkipEvening() {
    const current = doseStateRef.current
    if (!current || !hydrated) return
    try {
      await saveSkipLog(current.currentWeek, current.currentDay, "evening")
    } catch {}
    setDoseState(prev => {
      if (!prev) return prev
      const next = { ...prev, eveningSkipped: true }
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

  if (!schedule || !doseState) return null

  return (
    <DailyView
      schedule={schedule}
      doseState={doseState}
      onStateChange={handleStateChange}
      onCompleteDay={handleCompleteDay}
      onSkipMorning={handleSkipMorning}
      onSkipEvening={handleSkipEvening}
      appointmentDate={appointmentDate}
      onAppointmentChange={handleAppointmentChange}
      familyName={familyName}
      completedPositions={completedPositions}
    />
  )
}
