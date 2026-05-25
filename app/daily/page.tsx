"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
  saveDoseLog,
  countCompletedDaysInWeek,
  fetchAppointmentDate,
  saveAppointmentDate,
  fetchLastDay7Completion,
  getSession,
} from "@/lib/supabase"
import DailyView from "@/components/DailyView"

export default function DailyPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [doseState, setDoseState] = useState<DoseState | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [appointmentDate, setAppointmentDate] = useState<string | null>(null)
  const [anchorTimestamp, setAnchorTimestamp] = useState<string | null>(null)

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

      // Data fetching — errors here are not auth failures, never redirect to /login
      try {
        const s = await fetchSchedule()
        if (!s) {
          router.replace("/setup")
          return
        }
        const [ds, apptDate, anchorTs] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate().catch(() => null),
          fetchLastDay7Completion().catch(() => null),
        ])
        setSchedule(s)
        setDoseState(ds ?? { currentWeek: 1, currentDay: 1, checkedFoods: {} })
        setAppointmentDate(apptDate)
        setAnchorTimestamp(anchorTs)
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
      await saveDoseLog(currentWeek, currentDay, checkedFoods, completedAt)
      completedCount = await countCompletedDaysInWeek(currentWeek)
    } catch {
      // Log failed — proceed with normal day advance
    }

    if (currentDay === 7) {
      setAnchorTimestamp(completedAt)
    }

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

  if (!schedule || !doseState) return null

  return (
    <DailyView
      schedule={schedule}
      doseState={doseState}
      onStateChange={handleStateChange}
      onCompleteDay={handleCompleteDay}
      appointmentDate={appointmentDate}
      anchorTimestamp={anchorTimestamp}
      onAppointmentChange={handleAppointmentChange}
    />
  )
}
