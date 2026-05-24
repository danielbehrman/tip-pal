# Implementation Plan — Phase 2, F2: Supabase Auth

**Status:** Ready for Dev  
**Architect:** Claude Code (Architect Agent)  
**Date:** 2026-05-23  
**Ticket:** F2 — Require login before accessing the app

---

## Overview

F1 built a Supabase-backed app with no auth — all queries ran under the anon key scoped by a hardcoded `NEXT_PUBLIC_MVP_FAMILY_ID`. F2 replaces that scaffold with real Supabase Auth: email/password login, session persistence via Supabase's built-in localStorage session manager, client-side route protection via `useEffect` redirects, RLS policies locked to authenticated users, and `family_id` resolved from the `profiles` table rather than an env var.

No self-registration, no password reset, no social login. Two accounts are manually provisioned in Supabase Auth dashboard.

---

## Ordering Constraints

The following sequence is mandatory. Steps within a section can be parallelized; sections cannot be reordered.

**1. Dan: Manual Supabase steps first** (Section 8) — create Auth users and insert profile rows before any code change is deployed. If the profiles table doesn't exist yet, run that DDL first. The app will 500 or loop if auth is wired but profiles rows are missing.

**2. RLS policy swap** (Section 1) — drop anon policies, add authenticated policies. Do this in Supabase SQL editor before deploying code that relies on authenticated queries. While the app is still on F1 code the anon policies still cover it; once F2 code ships the authenticated policies must already be live.

**3. Code changes** (Sections 2–7) — implement in the order listed. `lib/supabase.ts` must be updated before the page files that import from it.

**4. Remove `NEXT_PUBLIC_MVP_FAMILY_ID` from Vercel** (Section 9) — do this last, after deploying F2 code. Removing it before deployment would break the still-running F1 app.

---

## 1. RLS Policy Changes

Run all SQL in the Supabase SQL editor. The policy names below are the exact names to use (for idempotency and future drops).

### 1a. Drop F1 anon policies

```sql
-- schedules
DROP POLICY IF EXISTS "anon_all_schedules" ON public.schedules;

-- dose_state
DROP POLICY IF EXISTS "anon_all_dose_state" ON public.dose_state;
```

> Note: If F1 used different policy names, substitute the actual names. You can confirm current policy names with:
> `SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public';`

### 1b. Ensure the `profiles` table exists

If it does not already exist, create it before writing policies that reference it:

```sql
CREATE TABLE IF NOT EXISTS public.profiles (
  id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users may only read their own profile row
CREATE POLICY "users_own_profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);
```

### 1c. Add authenticated RLS policies for `schedules`

```sql
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_family_schedules"
  ON public.schedules
  FOR ALL
  USING (
    family_id = (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    family_id = (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  );
```

### 1d. Add authenticated RLS policies for `dose_state`

```sql
ALTER TABLE public.dose_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_family_dose_state"
  ON public.dose_state
  FOR ALL
  USING (
    family_id = (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    family_id = (
      SELECT family_id FROM public.profiles WHERE id = auth.uid()
    )
  );
```

---

## 2. `lib/supabase.ts` Changes

### What is removed

- `getMvpFamilyId()` — deleted entirely. No callers should remain after this change.

### What is added

Three new exported async functions. All use the same singleton `getClient()` already in the file.

```typescript
// Returns the authenticated user's family_id from the profiles table.
// Throws if the user is not authenticated or if the profile row is missing.
export async function getFamilyId(): Promise<string>

// Returns the current Supabase Auth session, or null if none exists.
export async function getSession(): Promise<import("@supabase/supabase-js").Session | null>

// Signs the current user out. Throws on error.
export async function signOut(): Promise<void>
```

### What changes in existing functions

Every function that previously called `getMvpFamilyId()` now calls `await getFamilyId()` instead. The function signatures themselves do not change (they remain `async`, they already return `Promise`).

Affected functions:
- `fetchSchedule()` — replace `const familyId = getMvpFamilyId()` with `const familyId = await getFamilyId()`
- `saveSchedule()` — same replacement
- `fetchDoseState()` — same replacement
- `saveDoseState()` — same replacement

### Implementation detail for `getFamilyId()`

```typescript
export async function getFamilyId(): Promise<string> {
  const { data: { session }, error: sessionError } = await getClient().auth.getSession()
  if (sessionError || !session) throw new Error("Not authenticated")
  const { data, error } = await getClient()
    .from("profiles")
    .select("family_id")
    .eq("id", session.user.id)
    .single()
  if (error || !data) throw new Error("Profile not found for authenticated user")
  return data.family_id as string
}
```

### Implementation detail for `getSession()`

```typescript
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await getClient().auth.getSession()
  return session
}
```

### Implementation detail for `signOut()`

```typescript
export async function signOut(): Promise<void> {
  const { error } = await getClient().auth.signOut()
  if (error) throw error
}
```

### Full updated import block

Add `Session` to the `@supabase/supabase-js` import line:

```typescript
import { createClient, SupabaseClient, Session } from "@supabase/supabase-js"
```

---

## 3. New File: `app/login/page.tsx`

Create this file from scratch.

### Component spec

**`"use client"` directive** — required (uses state and router).

**Imports:**
- `useState` from `"react"`
- `useRouter` from `"next/navigation"`
- `useEffect` from `"react"`
- `getSession` and `getClient` from `"@/lib/supabase"` (see note below)

**Note on sign-in call:** The login page calls `getClient().auth.signInWithPassword()` directly — this is the one place in the app that needs the raw auth client call. Do not add a `signIn()` wrapper to `lib/supabase.ts`; the login page is the only caller and the indirection adds no value.

**State:**
```typescript
const [email, setEmail] = useState("")
const [password, setPassword] = useState("")
const [loading, setLoading] = useState(false)
const [error, setError] = useState<string | null>(null)
```

**Auth redirect on mount** — if the user is already authenticated, redirect to `/daily`:

```typescript
useEffect(() => {
  getSession().then((session) => {
    if (session) router.replace("/daily")
  })
}, [router])
```

**Sign-in handler:**

```typescript
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
```

**Important:** The error message is always the generic "Incorrect email or password" regardless of the Supabase error code. Do not surface raw Supabase error strings.

**Render — full JSX structure:**

```tsx
<main className="max-w-sm mx-auto px-4 py-16 min-h-screen flex flex-col justify-center">
  <h1 className="text-2xl font-bold mb-8 text-center">Joshy's Doses</h1>
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
</main>
```

No registration link, no forgot password link, no other UI.

---

## 4. `app/page.tsx` Changes

The root page currently calls `fetchSchedule()` to decide where to redirect. After F2, it must first check auth — unauthenticated users go to `/login`, not to `/setup`.

**Updated `checkSchedule` function:**

```typescript
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
```

**Updated import line:**
```typescript
import { fetchSchedule, getSession } from "@/lib/supabase"
```

The catch branch now redirects to `/login` rather than `/setup`, because the most likely unhandled error at root is an auth failure (e.g. profile missing) rather than a missing schedule.

---

## 5. `app/daily/page.tsx` Changes

### Auth check added to `load()`

The auth check runs first. If no session exists, redirect to `/login` immediately without attempting any Supabase queries.

**Updated `load()` function:**

```typescript
async function load() {
  try {
    const session = await getSession()
    if (!session) {
      router.replace("/login")
      return
    }
    const s = await fetchSchedule()
    if (!s) {
      router.replace("/setup")
      return
    }
    const ds = await fetchDoseState()
    setSchedule(s)
    setDoseState(ds ?? { currentWeek: 1, currentDay: 1, checkedFoods: {} })
    setHydrated(true)
  } catch {
    router.replace("/login")
  }
}
```

The catch now redirects to `/login` — any thrown error at this stage is most likely an auth or profile error, not a missing schedule. A missing schedule redirects explicitly before the catch.

### Sign out wired up

Pass a new `onSignOut` prop to `DailyView`:

```typescript
async function handleSignOut() {
  try {
    await signOut()
  } finally {
    router.replace("/login")
  }
}
```

Updated `DailyView` render:
```tsx
<DailyView
  schedule={schedule}
  doseState={doseState}
  onStateChange={handleStateChange}
  onSignOut={handleSignOut}
/>
```

**Updated import line:**
```typescript
import { fetchSchedule, fetchDoseState, saveDoseState, getSession, signOut } from "@/lib/supabase"
```

---

## 6. `app/setup/page.tsx` Changes

Add an auth check on mount. `SetupPage` currently has no `useEffect`. Add one:

```typescript
useEffect(() => {
  getSession().then((session) => {
    if (!session) router.replace("/login")
  })
}, [router])
```

**Updated import lines:**
```typescript
import { useEffect } from "react"  // add useEffect to existing React import
import { saveSchedule, saveDoseState, getSession } from "@/lib/supabase"
```

`router` is already declared via `useRouter()` in this component.

There is no full auth-aware load sequence needed in `SetupPage` — it does not fetch any family data on mount, it only saves on confirm. The `saveSchedule` and `saveDoseState` calls inside `handleConfirm` will naturally fail with an RLS error if somehow called unauthenticated, which is sufficient defensive coverage. The `useEffect` guard is the primary protection.

---

## 7. `components/DailyView.tsx` Changes

### Prop addition

Add `onSignOut` to the props interface:

```typescript
interface DailyViewProps {
  schedule: ParsedSchedule
  doseState: DoseState
  onStateChange: (state: DoseState) => void
  onSignOut: () => void
}
```

Destructure it in the function signature:
```typescript
export default function DailyView({ schedule, doseState, onStateChange, onSignOut }: DailyViewProps)
```

### Sign out link placement

The existing footer section (lines 167–171) contains:

```tsx
<div className="text-center mt-4 pb-4">
  <Link href="/setup" className="text-sm text-gray-400 underline">
    Re-parse schedule
  </Link>
</div>
```

Replace with:

```tsx
<div className="text-center mt-4 pb-4 flex flex-col gap-2">
  <Link href="/setup" className="text-sm text-gray-400 underline">
    Re-parse schedule
  </Link>
  <button
    onClick={onSignOut}
    className="text-sm text-gray-400 underline bg-transparent border-none cursor-pointer"
  >
    Sign out
  </button>
</div>
```

"Sign out" sits directly below "Re-parse schedule" in the same footer block. Both are visually de-emphasized (small, gray, underlined).

---

## 8. Manual Supabase Steps for Dan

These steps must be completed before deploying F2 code.

### Step 1 — Create Auth users in Supabase dashboard

1. Open Supabase dashboard → Authentication → Users → "Invite user" or "Add user"
2. Create user for Dan: `daniel.behrman@gmail.com` — set a password
3. Create user for Dan's wife: her email address — set a password
4. Note the `id` (UUID) shown for each user after creation — you will need them for Step 3

### Step 2 — Confirm the `profiles` table exists

If you ran the DDL in Section 1b, the table exists. Verify:

```sql
SELECT * FROM public.profiles;
```

### Step 3 — Insert profile rows

Run this SQL after creating both Auth users. Replace the placeholder UUIDs with the actual `id` values from Step 1:

```sql
INSERT INTO public.profiles (id, family_id) VALUES
  ('<DAN_AUTH_USER_UUID>',   '00000000-0000-0000-0000-000000000001'),
  ('<WIFE_AUTH_USER_UUID>',  '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
```

Both users share the same `family_id` — the single MVP family.

### Step 4 — Verify

```sql
SELECT p.id, p.family_id, u.email
FROM public.profiles p
JOIN auth.users u ON u.id = p.id;
```

Expected: two rows, both with `family_id = '00000000-0000-0000-0000-000000000001'`.

---

## 9. Vercel Environment Variable Changes

### Remove

| Variable | Action |
|---|---|
| `NEXT_PUBLIC_MVP_FAMILY_ID` | Remove from all environments (Production, Preview, Development) |

Remove this only after F2 code is deployed. The variable is no longer referenced in code and any remaining reference would be dead, but remove it to keep env vars clean and to prevent future confusion.

### Retain (no change)

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No change |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No change — Supabase Auth uses the anon key for login flows; RLS policies enforce access control |

No new env vars are needed. Supabase session storage is handled automatically by `@supabase/supabase-js` in the browser via its own localStorage keys (separate from and unrelated to the app data localStorage that was removed in F1).

---

## 10. Edge Cases

### Session expired mid-session

Supabase automatically refreshes the session token in the background using its built-in refresh logic. If the refresh silently fails (e.g. network outage, token revoked), the next Supabase query will return an auth error. The existing `catch` blocks in `daily/page.tsx` redirect to `/login` on any thrown error — this is sufficient coverage. No additional session-expiry detection is needed for MVP.

### Profile row missing for an authenticated user

`getFamilyId()` throws `"Profile not found for authenticated user"` if the profile row is absent. This propagates through `fetchSchedule()`, `fetchDoseState()`, etc., which are wrapped in `try/catch` blocks that redirect to `/login`. The user will loop at the login page until Dan manually inserts the missing profile row. This is acceptable for a two-user MVP — there is no self-recovery path needed.

### Supabase Auth unreachable

`getSession()` catches network errors and returns whatever state the client has cached locally. If Supabase is completely unreachable, the client may return a stale session from its own localStorage cache, allowing reads to appear to succeed or fail depending on network state when the actual queries run. For MVP this is acceptable — the app is medical-use-only by two known users and a brief outage is not a safety risk. No offline mode is in scope.

### Both parents logged in on different devices simultaneously

No conflict. Each device has its own session. Supabase handles concurrent sessions for the same user. RLS scoping is by `family_id` not by individual user, so both parents see the same `dose_state`. Concurrent writes to `dose_state` use `upsert` with `onConflict: "family_id"` — last write wins. This is intentional MVP behavior.

### User on `/login` with a valid session (e.g. hits back button after sign-out)

The `useEffect` in `app/login/page.tsx` runs `getSession()` on mount and redirects to `/daily` if a session exists. Back-button navigation after sign-out is clean because `signOut()` clears the session from the client's localStorage, so `getSession()` returns `null` and the redirect does not fire.

---

## File Changeset Summary

| File | Action |
|---|---|
| `lib/supabase.ts` | Modify — remove `getMvpFamilyId`, add `getFamilyId`, `getSession`, `signOut`, update 4 existing functions |
| `app/login/page.tsx` | Create new |
| `app/page.tsx` | Modify — add auth check before schedule check |
| `app/daily/page.tsx` | Modify — add auth check, add `handleSignOut`, pass `onSignOut` to DailyView |
| `app/setup/page.tsx` | Modify — add auth guard `useEffect` |
| `components/DailyView.tsx` | Modify — add `onSignOut` prop, add Sign out link in footer |

No new dependencies. No changes to `next.config.ts`, `app/layout.tsx`, or any other file.

---

## What Dev Must Not Do

- Do not add middleware (`middleware.ts`) — route protection is client-side `useEffect` only for this MVP
- Do not add a registration page or forgot-password flow — no UI for self-service auth
- Do not add a "remember me" toggle — sessions always persist
- Do not change the Supabase client initialization in `getClient()` — the anon key is correct for auth flows
- Do not surface raw Supabase error messages to users — always use the generic "Incorrect email or password" string
- Do not remove `NEXT_PUBLIC_MVP_FAMILY_ID` from Vercel before deploying F2 code
- Do not deviate from the `onSignOut` prop pattern — `DailyView` is a controlled component and must not call `signOut()` directly
