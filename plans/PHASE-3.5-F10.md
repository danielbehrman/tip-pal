# Phase 3.5 F10: Auth Screen Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the login screen (orange hero, sign-in/sign-up/forgot-password modes, medical disclaimer) and the first-parse screen (app-header style, empty avatar ring, warm paste UI with "Enter foods manually instead" secondary link).

**Architecture:** Full replacement of `app/login/page.tsx` and `app/setup/page.tsx`. Auth logic is unchanged (same `getClient().auth.*` calls). `ScheduleReview` component is preserved as-is — only the `paste`/`loading`/`error` views change in setup. Login gains two secondary modes (sign-up, forgot-password) toggled by state, not by route. No new routes, no schema changes.

**Tech Stack:** Next.js, React hooks, Tailwind + inline styles, `next/image`

## Global Constraints

- App name "Tip Pal" — never "TIP Pal"
- Colors: `#ff6b35` orange hero/CTAs, `#fffbf7` bg, `#fff` card/input bg, `#f0ddd4` borders/empty ring, `#2d1a0e` primary, `#9a6a55` secondary, `#c4927a` tertiary, `#dc2626` error red
- No changes to Supabase Auth logic (same `signInWithPassword`, `signUp`, `resetPasswordForEmail` calls)
- `process.env.NEXT_PUBLIC_API_BASE_URL ?? ""` prefix on all `/api/*` fetch calls (already in setup — preserve it)
- `npm run build` must pass with zero TypeScript errors

---

## File Map

| File | Change |
|---|---|
| `app/login/page.tsx` | Full replacement |
| `app/setup/page.tsx` | Full replacement |
| `components/PasteInput.tsx` | Unchanged (still imported by setup) |
| `components/ScheduleReview.tsx` | Unchanged |

---

## Key Design Specs

**Login hero:** Orange `#ff6b35` section occupying the top ~40% of the screen (`pt-20 pb-12`). Contains: `<Image src="/apple-touch-icon.png" width={80} height={80} className="rounded-2xl" />`, `<h1>Tip Pal</h1>` in white bold, tagline in rgba(255,255,255,0.85).

**Login form area:** `#fffbf7` flex-col gap-4. Three modes: `"signin" | "signup" | "forgot"`. On sign-in success → `/daily`. On sign-up success → `/setup`. On forgot, show email-only form → `resetPasswordForEmail` → inline "Check your email" confirmation.

**Medical disclaimer (login):** Exact text — "Tip Pal is not a medical device and is not affiliated with the Food Allergy Institute or the Tolerance Induction Program. Always follow your provider's instructions." — `text-xs text-center mt-auto` in `#c4927a`.

**Setup header:** Orange `#ff6b35` header (matching app style). Left side: empty SVG ring avatar (60×60 SVG, r=26, track `#f0ddd4` stroke 4, no progress arc, 🧒 centered in 44×44 circle `#fff3ec`). Right side: `<h1>Load your dosing plan</h1>` in white.

**Setup paste area:** Label "Paste your dosing plan" in `#2d1a0e`. Hint below CTA: "Copy from your patient portal (e.g. TIPConnect) and paste above." in `#c4927a`. CTA: "Parse dosing plan". Secondary link: "Enter foods manually instead." → `router.push("/onboarding")` (manual entry flow is a future feature; this link is a visual placeholder).

---

### Task 1: Login and First-Parse Screen Redesign

**Files:**
- Modify: `app/login/page.tsx` — full replacement
- Modify: `app/setup/page.tsx` — full replacement

- [ ] **Step 1: Write the complete replacement for `app/login/page.tsx`**

```tsx
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
```

- [ ] **Step 2: Write the complete replacement for `app/setup/page.tsx`**

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import ScheduleReview from "@/components/ScheduleReview"
import { ParsedSchedule } from "@/lib/types"
import { saveSchedule, saveDoseState, getSession } from "@/lib/supabase"
import { todayDateString } from "@/lib/schedule"

type View = "paste" | "loading" | "review" | "error"

export default function SetupPage() {
  const router = useRouter()
  const [view, setView] = useState<View>("paste")
  const [rawText, setRawText] = useState("")
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null)
  const [error, setError] = useState("")

  useEffect(() => {
    getSession().then((session) => {
      if (!session) router.replace("/login")
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSubmit() {
    setView("loading")
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""
      const res = await fetch(`${apiBase}/api/parse-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawText }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setError(data.error ?? "Unknown error")
        setView("error")
        return
      }
      setParsedSchedule(data.schedule)
      setView("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
      setView("error")
    }
  }

  async function handleConfirm() {
    if (!parsedSchedule) return
    try {
      await saveSchedule(parsedSchedule)
      await saveDoseState({
        currentWeek: 1,
        currentDay: 1,
        checkedFoods: {},
        cycleStartDate: todayDateString(),
        skipCount: 0,
        floorWeek: 1,
        floorDay: 1,
      })
      router.push("/onboarding")
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "Failed to save schedule. Please try again."
      setError(msg)
      setView("error")
    }
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#fffbf7" }}>
      {/* Orange header with empty ring avatar */}
      <header
        className="flex items-center gap-4 px-4 pt-5 pb-4"
        style={{ background: "#ff6b35" }}
      >
        {/* Empty progress ring avatar */}
        <div className="relative flex items-center justify-center shrink-0" style={{ width: 60, height: 60 }}>
          <svg width="60" height="60" viewBox="0 0 60 60">
            <circle cx="30" cy="30" r="26" fill="none" stroke="#f0ddd4" strokeWidth="4" />
          </svg>
          <div
            className="absolute rounded-full overflow-hidden flex items-center justify-center"
            style={{ width: 44, height: 44, background: "#fff3ec", fontSize: 22 }}
          >
            🧒
          </div>
        </div>
        <h1 className="text-xl font-semibold text-white">Load your dosing plan</h1>
      </header>

      {/* Paste view */}
      {(view === "paste" || view === "loading") && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: "#2d1a0e" }}>
              Paste your dosing plan
            </p>
            <textarea
              className="w-full p-4 rounded-xl text-base resize-none outline-none"
              style={{
                minHeight: 200,
                border: "0.5px solid #f0ddd4",
                color: "#2d1a0e",
                background: "#fff",
              }}
              placeholder="Paste dosing schedule notes here…"
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              disabled={view === "loading"}
            />
          </div>

          {view === "loading" ? (
            <p className="text-center text-sm py-3" style={{ color: "#9a6a55" }}>
              Parsing your dosing plan…
            </p>
          ) : (
            <>
              <button
                className="w-full py-4 rounded-xl text-base font-semibold text-white disabled:opacity-40"
                style={{ background: "#ff6b35" }}
                onClick={handleSubmit}
                disabled={rawText.trim() === ""}
              >
                Parse dosing plan
              </button>
              <p className="text-xs text-center" style={{ color: "#c4927a" }}>
                Copy from your patient portal (e.g. TIPConnect) and paste above.
              </p>
              <button
                type="button"
                className="text-sm text-center"
                style={{ color: "#9a6a55" }}
                onClick={() => router.push("/onboarding")}
              >
                Enter foods manually instead.
              </button>
            </>
          )}
        </div>
      )}

      {/* Review view */}
      {view === "review" && parsedSchedule && (
        <div className="px-4 pt-6 pb-24">
          <ScheduleReview
            schedule={parsedSchedule}
            onScheduleChange={setParsedSchedule}
            onConfirm={handleConfirm}
            onBack={() => setView("paste")}
          />
        </div>
      )}

      {/* Error view */}
      {view === "error" && (
        <div className="px-4 pt-6 pb-24 flex flex-col gap-4">
          <p className="text-sm font-medium" style={{ color: "#dc2626" }}>
            Error: {error}
          </p>
          <button
            className="w-full py-4 rounded-xl text-base font-semibold text-white"
            style={{ background: "#ff6b35" }}
            onClick={() => { setView("paste"); setError("") }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Full build**

```bash
npm run build 2>&1 | tail -8
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add app/login/page.tsx app/setup/page.tsx
git commit -m "feat(f10): redesign Login screen with orange hero and Setup screen with warm paste UI"
```
