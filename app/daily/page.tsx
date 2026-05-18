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

  useEffect(() => {
    const s = getSchedule()
    if (!s) {
      router.replace("/setup")
      return
    }
    setSchedule(s)
    setDoseState(getDoseState())
  }, [router])

  function handleStateChange(state: DoseState) {
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
