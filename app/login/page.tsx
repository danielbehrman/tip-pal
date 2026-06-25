"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { getSession, getClient } from "@/lib/supabase"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getSession().then((session) => {
      if (session) router.replace("/daily")
    })
  }, [router])

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await getClient().auth.signInWithPassword({ email, password })
    if (error) {
      setError("Incorrect email or password")
      setLoading(false)
      return
    }
    router.replace("/daily")
  }

  return (
    <main className="max-w-sm mx-auto px-4 py-16 min-h-screen flex flex-col justify-center">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-bold mb-3">TIP Pal</h1>
        <p className="text-gray-600 text-base mb-3">A daily dosing assistant for families in food allergy tolerance induction programs.</p>
        <p className="text-gray-400 text-sm">Early access coming soon.</p>
      </div>
      <form onSubmit={handleSignIn} className="flex flex-col gap-4">
        <input
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="border border-gray-300 rounded-xl px-4 py-3 text-base"
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="border border-gray-300 rounded-xl px-4 py-3 text-base"
        />
        {error && (
          <p className="text-red-700 text-sm font-medium">{error}</p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="flex justify-center gap-6 mt-8">
        <Link href="/privacy" className="text-xs text-gray-400 underline">Privacy</Link>
        <Link href="/disclaimer" className="text-xs text-gray-400 underline">Disclaimer</Link>
      </div>
    </main>
  )
}
