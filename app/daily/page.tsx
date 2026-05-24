"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState } from "@/lib/types"
import { fetchSchedule, fetchDoseState, saveDoseState, getSession } from "@/lib/supabase"
import DailyView from "@/components/DailyView"

export default function DailyPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [doseState, setDoseState] = useState<DoseState | null>(null)
  const [hydrated, setHydrated] = useState(false)

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
        const ds = await fetchDoseState()
        setSchedule(s)
        setDoseState(ds ?? { currentWeek: 1, currentDay: 1, checkedFoods: {} })
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

  if (!schedule || !doseState) return null

  return (
    <DailyView
      schedule={schedule}
      doseState={doseState}
      onStateChange={handleStateChange}
    />
  )
}
