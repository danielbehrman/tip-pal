"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  fetchFoodProgress,
  saveRecommendedGiven,
  getSession,
} from "@/lib/supabase"
import { getFurthestAheadPosition } from "@/lib/schedule"
import { FoodProgress } from "@/lib/types"
import RecommendedFoodsView from "@/components/RecommendedFoodsView"

export default function FoodsPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [currentWeek, setCurrentWeek] = useState(1)
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [hydrated, setHydrated] = useState(false)
  const countsRef = useRef<Record<string, Record<string, number>>>({})

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
        const [s, ds, progress] = await Promise.all([
          fetchSchedule(),
          fetchDoseState(),
          fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
        ])
        if (!s) {
          router.replace("/setup")
          return
        }
        const initialCounts = ds?.recommendedFoodCounts ?? {}
        const week = progress.size > 0 ? getFurthestAheadPosition(progress).week : (ds?.currentWeek ?? 1)
        setSchedule(s)
        setCurrentWeek(week)
        setCounts(initialCounts)
        countsRef.current = initialCounts
        setHydrated(true)
      } catch {
        router.replace("/login")
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleGive(foodName: string) {
    setCounts(prev => {
      const weekKey = String(currentWeek)
      const weekCounts = prev[weekKey] ?? {}
      const updated = {
        ...prev,
        [weekKey]: { ...weekCounts, [foodName]: (weekCounts[foodName] ?? 0) + 1 },
      }
      countsRef.current = updated
      saveRecommendedGiven(updated).catch(() => {})
      return updated
    })
  }

  function handleUndo(foodName: string) {
    setCounts(prev => {
      const weekKey = String(currentWeek)
      const weekCounts = prev[weekKey] ?? {}
      const updated = {
        ...prev,
        [weekKey]: { ...weekCounts, [foodName]: Math.max(0, (weekCounts[foodName] ?? 0) - 1) },
      }
      countsRef.current = updated
      saveRecommendedGiven(updated).catch(() => {})
      return updated
    })
  }

  if (!hydrated || !schedule) return null

  return (
    <RecommendedFoodsView
      schedule={schedule}
      currentWeek={currentWeek}
      counts={counts}
      onGive={handleGive}
      onUndo={handleUndo}
    />
  )
}
