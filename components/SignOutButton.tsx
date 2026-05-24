"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { getSession, signOut, getClient } from "@/lib/supabase"

export default function SignOutButton() {
  const router = useRouter()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    getSession().then((session) => setVisible(!!session))

    const { data: { subscription } } = getClient().auth.onAuthStateChange((_event, session) => {
      setVisible(!!session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!visible) return null

  async function handleSignOut() {
    try {
      await signOut()
    } finally {
      router.replace("/login")
    }
  }

  return (
    <button
      onClick={handleSignOut}
      className="fixed top-4 right-4 text-sm text-gray-400 hover:text-gray-600 z-50"
    >
      Sign out
    </button>
  )
}
