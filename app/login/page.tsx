"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { getSession, getClient } from "@/lib/supabase"

type Mode = "signin" | "signup" | "forgot"

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [forgotSent, setForgotSent] = useState(false)

  useEffect(() => {
    getSession().then((session) => {
      if (session) router.replace("/daily")
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setForgotSent(false)
  }

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

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await getClient().auth.signUp({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.replace("/setup")
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await getClient().auth.resetPasswordForEmail(email)
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    setForgotSent(true)
    setLoading(false)
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Orange hero */}
      <div
        className="flex flex-col items-center px-6 pt-20 pb-12 gap-3"
        style={{ background: "#ff6b35" }}
      >
        <Image
          src="/apple-touch-icon.png"
          alt="Tip Pal"
          width={80}
          height={80}
          className="rounded-2xl"
        />
        <h1 className="text-2xl font-bold text-white">Tip Pal</h1>
        <p
          className="text-sm text-center"
          style={{ color: "rgba(255,255,255,0.85)" }}
        >
          Your family&apos;s daily dosing companion
        </p>
      </div>

      {/* Form area */}
      <div className="flex flex-col flex-1 px-6 pt-8 pb-10 gap-4">
        {/* Sign in */}
        {mode === "signin" && (
          <form onSubmit={handleSignIn} className="flex flex-col gap-4">
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 text-base rounded-xl outline-none"
              style={{ border: "0.5px solid #f0ddd4", background: "#fff", color: "#2d1a0e" }}
            />
            <input
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 text-base rounded-xl outline-none"
              style={{ border: "0.5px solid #f0ddd4", background: "#fff", color: "#2d1a0e" }}
            />
            {error && (
              <p className="text-sm" style={{ color: "#dc2626" }}>{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
              style={{ background: "#ff6b35" }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className="text-sm text-center"
              style={{ color: "#9a6a55" }}
              onClick={() => switchMode("forgot")}
            >
              Forgot password?
            </button>
            <button
              type="button"
              className="text-sm text-center font-medium"
              style={{ color: "#ff6b35" }}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </form>
        )}

        {/* Sign up */}
        {mode === "signup" && (
          <form onSubmit={handleSignUp} className="flex flex-col gap-4">
            <p className="text-base font-semibold" style={{ color: "#2d1a0e" }}>
              Create your account
            </p>
            <input
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 text-base rounded-xl outline-none"
              style={{ border: "0.5px solid #f0ddd4", background: "#fff", color: "#2d1a0e" }}
            />
            <input
              type="password"
              placeholder="Password"
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-4 py-3 text-base rounded-xl outline-none"
              style={{ border: "0.5px solid #f0ddd4", background: "#fff", color: "#2d1a0e" }}
            />
            {error && (
              <p className="text-sm" style={{ color: "#dc2626" }}>{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
              style={{ background: "#ff6b35" }}
            >
              {loading ? "Creating account…" : "Create account"}
            </button>
            <button
              type="button"
              className="text-sm text-center"
              style={{ color: "#9a6a55" }}
              onClick={() => switchMode("signin")}
            >
              Already have an account? Sign in
            </button>
          </form>
        )}

        {/* Forgot password */}
        {mode === "forgot" && (
          <form onSubmit={handleForgotPassword} className="flex flex-col gap-4">
            <p className="text-base font-semibold" style={{ color: "#2d1a0e" }}>
              Reset your password
            </p>
            {forgotSent ? (
              <p className="text-sm" style={{ color: "#9a6a55" }}>
                Check your email for a password reset link.
              </p>
            ) : (
              <>
                <input
                  type="email"
                  placeholder="Email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 text-base rounded-xl outline-none"
                  style={{ border: "0.5px solid #f0ddd4", background: "#fff", color: "#2d1a0e" }}
                />
                {error && (
                  <p className="text-sm" style={{ color: "#dc2626" }}>{error}</p>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-50"
                  style={{ background: "#ff6b35" }}
                >
                  {loading ? "Sending…" : "Send reset email"}
                </button>
              </>
            )}
            <button
              type="button"
              className="text-sm text-center"
              style={{ color: "#9a6a55" }}
              onClick={() => switchMode("signin")}
            >
              Back to sign in
            </button>
          </form>
        )}

        {/* Medical disclaimer */}
        <p
          className="text-xs text-center mt-auto pt-6"
          style={{ color: "#c4927a" }}
        >
          Tip Pal is not a medical device and is not affiliated with the Food Allergy Institute or the Tolerance Induction Program. Always follow your provider&apos;s instructions.
        </p>
      </div>
    </div>
  )
}
