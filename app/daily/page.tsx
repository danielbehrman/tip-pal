"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule, DoseState } from "@/lib/types"
import { getSchedule, getDoseState, saveDoseState } from "@/lib/storage"
import DailyView from "@/components/DailyView"

export default function DailyPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [doseState, setDoseState] = useState<DoseState | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Load once on mount — empty deps so router ref changes never re-trigger
  useEffect(() => {
    const s = getSchedule()
    if (!s) {
      router.replace("/setup")
      return
    }
    setSchedule(s)
    setDoseState(getDoseState())
    setHydrated(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save only after hydration so initial mount never writes defaults over real data
  useEffect(() => {
    if (!hydrated || !doseState) return
    saveDoseState(doseState)
  }, [doseState, hydrated])

  function handleStateChange(state: DoseState) {
    setDoseState(state)
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
