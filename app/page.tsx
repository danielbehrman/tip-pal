"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function RootPage() {
  const router = useRouter()

  useEffect(() => {
    const schedule = localStorage.getItem("joshy-schedule")
    if (schedule) {
      router.replace("/daily")
    } else {
      router.replace("/setup")
    }
  }, [router])

  return null
}
