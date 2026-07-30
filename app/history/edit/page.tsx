"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule, DoseLogDay, DoseState, FoodProgress } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchRecentCompletedDays,
  updateDoseLogCheckedFoods,
  fetchFoodProgress,
  saveFoodProgress,
  fetchDoseState,
  saveDoseState,
  saveRecommendedGiven,
} from "@/lib/supabase"
import { getGlobalPosition, cycleStartDateForPosition, applyCrossCategoryCredit } from "@/lib/schedule"
import RecentDaysEditor from "@/components/RecentDaysEditor"

export default function HistoryEditPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [days, setDays] = useState<DoseLogDay[]>([])
  const [foodProgress, setFoodProgress] = useState<Map<string, FoodProgress>>(new Map())
  const foodProgressRef = useRef<Map<string, FoodProgress>>(new Map())
  const recommendedFoodCountsRef = useRef<Record<string, Record<string, number>>>({})
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
        const [s, recentDays, progress, ds] = await Promise.all([
          fetchSchedule(),
          fetchRecentCompletedDays(),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
          fetchDoseState().catch(() => null),
        ])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setDays(recentDays)
        setFoodProgress(progress)
        foodProgressRef.current = progress
        recommendedFoodCountsRef.current = ds?.recommendedFoodCounts ?? {}
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleToggle(
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

    const wasChecked = !!current[key]
    const entry = days.find(d => d.id === id)
    if (entry) {
      const entrySchedule = entry.scheduleSnapshot ?? schedule!
      const updatedCounts = applyCrossCategoryCredit(
        entrySchedule.recommendedFoods ?? [],
        recommendedFoodCountsRef.current,
        String(entry.week),
        key,
        val,
        wasChecked
      )
      if (updatedCounts) {
        recommendedFoodCountsRef.current = updatedCounts
        saveRecommendedGiven(updatedCounts).catch(() => {})
      }
    }

    // Only a treatment food going from unchecked -> checked advances position.
    if (!val || wasChecked || !key.startsWith("evening-")) return

    const foodName = key.slice("evening-".length)
    const fp = foodProgressRef.current.get(foodName)
    if (!fp) return

    const oldGlobal = getGlobalPosition(foodProgressRef.current)
    const nowIso = new Date().toISOString()
    const newCompletedDays = fp.completedDays + 1
    const updatedFp: FoodProgress =
      newCompletedDays >= 7
        ? { ...fp, week: fp.week + 1, day: 1, completedDays: 0, lastCompletedAt: nowIso }
        : { ...fp, day: newCompletedDays + 1, completedDays: newCompletedDays, lastCompletedAt: nowIso }

    const nextProgress = new Map(foodProgressRef.current)
    nextProgress.set(foodName, updatedFp)
    foodProgressRef.current = nextProgress
    setFoodProgress(nextProgress)

    try {
      await saveFoodProgress(nextProgress)
      const newGlobal = getGlobalPosition(nextProgress)
      if (newGlobal.week !== oldGlobal.week || newGlobal.day !== oldGlobal.day) {
        const existing: DoseState | null = await fetchDoseState().catch(() => null)
        if (existing) {
          await saveDoseState({
            ...existing,
            currentWeek: newGlobal.week,
            currentDay: newGlobal.day,
            cycleStartDate: cycleStartDateForPosition(newGlobal.week, newGlobal.day),
            floorWeek: newGlobal.week,
            floorDay: newGlobal.day,
          })
        }
      }
    } catch {
      // Save failed — local state still reflects the correction; next load re-fetches truth
    }
  }

  if (loading || !schedule) return null

  return (
    <main className="max-w-lg mx-auto px-4 py-6 min-h-screen">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/history" className="text-gray-500 text-sm underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold">Edit Recent Days</h1>
      </div>
      <p className="text-sm text-gray-500 mb-6">
        Showing the 3 most recently logged days. Checking a previously-unchecked treatment food advances that food&apos;s position — gaps outside these 3 days can&apos;t be corrected here.
      </p>
      <RecentDaysEditor schedule={schedule} days={days} onToggle={handleToggle} />
    </main>
  )
}
