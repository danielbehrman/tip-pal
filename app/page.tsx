"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { fetchSchedule } from "@/lib/supabase"

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    async function checkSchedule() {
      try {
        const schedule = await fetchSchedule()
        if (schedule) {
          router.replace("/daily")
        } else {
          router.replace("/setup")
        }
      } catch {
        router.replace("/setup")
      }
    }
    checkSchedule()
  }, [router])

  return null
}
