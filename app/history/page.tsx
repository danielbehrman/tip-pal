"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import { getSession, fetchSchedule, fetchAllDoseLogDays } from "@/lib/supabase"
import DoseHistoryLog from "@/components/DoseHistoryLog"

export default function HistoryPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [days, setDays] = useState<DoseLogDay[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
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
      try {
        const [s, allDays] = await Promise.all([fetchSchedule(), fetchAllDoseLogDays()])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setDays(allDays)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading || !schedule) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      <header
        className="flex items-center justify-between px-4 pt-5 pb-4"
        style={{ background: "#ff6b35" }}
      >
        <h1 className="text-xl font-semibold text-white">History</h1>
        <Link
          href="/history/edit"
          className="text-sm font-medium"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          Edit
        </Link>
      </header>
      <DoseHistoryLog schedule={schedule} days={days} />
    </div>
  )
}
