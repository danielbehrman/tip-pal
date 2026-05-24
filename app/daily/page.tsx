"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveDoseState,
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
      try {
        const session = await getSession()
        if (!session) {
          router.replace("/login")
          return
        }
        const s = await fetchSchedule()
        if (!s) {
          router.replace("/setup")
          return
        }
        const [ds, apptDate, anchorTs] = await Promise.all([
          fetchDoseState(),
          fetchAppointmentDate(),
          fetchLastDay7Completion(),
        ])
        setSchedule(s)
        setDoseState(ds ?? { currentWeek: 1, currentDay: 1, checkedFoods: {} })
        setAppointmentDate(apptDate)
        setAnchorTimestamp(anchorTs)
        setHydrated(true)
      } catch {
        router.replace("/login")
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleStateChange(state: DoseState) {
    if (!hydrated) return
    setDoseState(state)
    try {
      await saveDoseState(state)
    } catch {
      // Save failed — local state already updated. Server state wins on next refresh.
    }
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
      appointmentDate={appointmentDate}
      anchorTimestamp={anchorTimestamp}
      onAppointmentChange={handleAppointmentChange}
    />
  )
}
