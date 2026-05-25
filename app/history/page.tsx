"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchRecentCompletedDays,
  updateDoseLogCheckedFoods,
} from "@/lib/supabase"
import RecentDaysEditor from "@/components/RecentDaysEditor"

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
        const [s, recentDays] = await Promise.all([
          fetchSchedule(),
          fetchRecentCompletedDays(),
        ])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setDays(recentDays)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleToggle(
    id: string,
    key: string,
    val: boolean,
    current: Record<string, boolean>
  ) {
    const updated = { ...current, [key]: val }
    setDays(prev =>
      prev.map(d => (d.id === id ? { ...d, checkedFoods: updated } : d))
    )
    updateDoseLogCheckedFoods(id, updated).catch(() => {})
  }

  if (loading || !schedule) return null

  return (
    <main className="max-w-lg mx-auto px-4 py-6 min-h-screen">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/daily" className="text-gray-500 text-sm underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold">Edit Recent Days</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Showing the 3 most recently completed days. Toggle any checkbox to correct the record — this does not affect week advancement.
      </p>
      <RecentDaysEditor schedule={schedule} days={days} onToggle={handleToggle} />
    </main>
  )
}
