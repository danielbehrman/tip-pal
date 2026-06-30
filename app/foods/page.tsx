"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveRecommendedGiven,
  getSession,
} from "@/lib/supabase"
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
        const [s, ds] = await Promise.all([fetchSchedule(), fetchDoseState()])
        if (!s) {
          router.replace("/setup")
          return
        }
        const initialCounts = ds?.recommendedFoodCounts ?? {}
        setSchedule(s)
        setCurrentWeek(ds?.currentWeek ?? 1)
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
