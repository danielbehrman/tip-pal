"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { fetchSchedule, getSession } from "@/lib/supabase"

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    async function checkSchedule() {
      try {
        const session = await getSession()
        if (!session) {
          router.replace("/login")
          return
        }
        const schedule = await fetchSchedule()
        if (schedule) {
          router.replace("/daily")
        } else {
          router.replace("/setup")
        }
      } catch {
        router.replace("/login")
      }
    }
    checkSchedule()
  }, [router])

  return null
}
