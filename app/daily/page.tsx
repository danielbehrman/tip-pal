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

  // Load once on mount — empty deps prevents router ref changes from re-triggering
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

  // Save synchronously with the new state — no effect dependency chain, no timing ambiguity
  function handleStateChange(state: DoseState) {
    if (!hydrated) return
    setDoseState(state)
    saveDoseState(state)
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
