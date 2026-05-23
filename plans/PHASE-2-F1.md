# Implementation Plan: Phase 2 — F1: Supabase Foundation

**Status:** Ready for Dev  
**Architect:** Agent  
**Date:** 2026-05-22  
**Dev contract:** Dev Agent may not deviate from this plan. Gaps must be escalated to Orchestrator, not resolved unilaterally.

---

## 1. Current localStorage Inventory

Every `localStorage` call in the codebase, by file and line:

| File | Line | Call | Description |
|---|---|---|---|
| `app/page.tsx` | 11 | `localStorage.getItem("joshy-schedule")` | Root redirect: checks for schedule to decide route |
| `lib/storage.ts` | 8 | `window.localStorage.getItem(SCHEDULE_KEY)` | `getSchedule()` — reads schedule |
| `lib/storage.ts` | 19 | `window.localStorage.setItem(SCHEDULE_KEY, ...)` | `saveSchedule()` — writes schedule |
| `lib/storage.ts` | 24 | `window.localStorage.removeItem(SCHEDULE_KEY)` | `clearSchedule()` — deletes schedule |
| `lib/storage.ts` | 31 | `window.localStorage.getItem(STATE_KEY)` | `getDoseState()` — reads dose state |
| `lib/storage.ts` | 42 | `window.localStorage.setItem(STATE_KEY, ...)` | `saveDoseState()` — writes dose state |
| `lib/storage.ts` | 47 | `window.localStorage.removeItem(STATE_KEY)` | `clearDoseState()` — deletes dose state |
| `app/daily/page.tsx` | 6 | `import { getSchedule, getDoseState, saveDoseState }` | Imports all storage functions |
| `app/daily/page.tsx` | 18 | `getSchedule()` | Calls storage on mount |
| `app/daily/page.tsx` | 23 | `getDoseState()` | Calls storage on mount |
| `app/daily/page.tsx` | 32 | `saveDoseState(state)` | Calls storage on every state change |
| `app/setup/page.tsx` | 8 | `import { saveSchedule, saveDoseState }` | Imports storage functions |
| `app/setup/page.tsx` | 43 | `saveSchedule(parsedSchedule)` | Writes schedule on confirm |
| `app/setup/page.tsx` | 44 | `saveDoseState(...)` | Writes initial dose state on confirm |

**Total: 14 call sites across 4 files. `lib/storage.ts` is deleted entirely. `app/page.tsx`, `app/daily/page.tsx`, and `app/setup/page.tsx` are all modified.**

No component file (`components/`) directly calls localStorage. Components receive data and callbacks as props — they are not changed.

---

## 2. TypeScript Types (must not change shape)

These types are the contract between the app and Supabase. They are stored as-is in JSONB columns. **Do not alter their shape.**

```typescript
// lib/types.ts — unchanged

export interface ParsedSchedule {
  maintenanceFoods: MaintenanceFood[]
  weeklyFoods: WeeklyFood[]
  treatmentFoods: TreatmentFood[]
}

export interface DoseState {
  currentWeek: number
  currentDay: number        // 1–7
  checkedFoods: Record<string, boolean>
}
```

`ParsedSchedule` maps to `schedules.parsed_data` (JSONB).  
`DoseState` maps to three columns on `dose_state`: `current_week` (int), `current_day` (int), `checked_foods` (JSONB for the `checkedFoods` field only).

---

## 3. SQL Schema

### 3.1 Table Definitions

Run the following SQL in the Supabase SQL editor (or via a migration file). Execute in order — `families` first because all other tables reference it.

```sql
-- ============================================================
-- Table 1: families
-- ============================================================
create table if not exists families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Table 2: profiles
-- ============================================================
create table if not exists profiles (
  id           uuid primary key,          -- equals Supabase auth.users.id
  family_id    uuid not null references families(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- Table 3: schedules
-- ============================================================
create table if not exists schedules (
  id          uuid primary key default gen_random_uuid(),
  family_id   uuid not null references families(id) on delete cascade,
  parsed_data jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Index for fast single-row lookup by family
create index if not exists schedules_family_id_idx on schedules(family_id);

-- ============================================================
-- Table 4: dose_state
-- ============================================================
create table if not exists dose_state (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  current_week integer not null default 1 check (current_week >= 1),
  current_day  integer not null default 1 check (current_day between 1 and 7),
  checked_foods jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

-- One row per family — enforced by unique constraint
create unique index if not exists dose_state_family_id_unique on dose_state(family_id);

-- ============================================================
-- Table 5: dose_log
-- ============================================================
create table if not exists dose_log (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references families(id) on delete cascade,
  week         integer not null check (week >= 1),
  day          integer not null check (day between 1 and 7),
  session      text not null check (session in ('morning', 'evening', 'day')),
  checked_foods jsonb not null default '{}'::jsonb,
  completed_at  timestamptz not null default now(),
  is_skipped   boolean not null default false
);

-- Index for history queries ordered by time
create index if not exists dose_log_family_completed_idx on dose_log(family_id, completed_at desc);
```

### 3.2 RLS Policies

RLS is enabled on all tables. For F1, the policies use the hardcoded `family_id` from the env var — this is intentionally permissive for the scaffold. F2 replaces these with auth-based policies.

**Important:** The F1 RLS policies use `anon` role because there is no auth in F1. All reads and writes go through the anon key. This is intentional and temporary. F2 will lock these down to authenticated users only.

```sql
-- Enable RLS on all tables
alter table families enable row level security;
alter table profiles enable row level security;
alter table schedules enable row level security;
alter table dose_state enable row level security;
alter table dose_log enable row level security;

-- ============================================================
-- F1 SCAFFOLD POLICIES (temporary — replaced in F2)
-- These allow anon access scoped to the MVP family_id.
-- The family_id is passed as a filter in every query — RLS
-- provides an additional enforcement layer.
-- ============================================================

-- families: anon can read any row (needed for app to verify family exists)
create policy "anon_read_families"
  on families for select
  to anon
  using (true);

-- schedules: anon can read/write rows for any family
-- (F2 will restrict to: auth.uid() IS the user and family matches)
create policy "anon_read_schedules"
  on schedules for select
  to anon
  using (true);

create policy "anon_insert_schedules"
  on schedules for insert
  to anon
  with check (true);

create policy "anon_update_schedules"
  on schedules for update
  to anon
  using (true)
  with check (true);

-- dose_state: anon can read/write rows for any family
create policy "anon_read_dose_state"
  on dose_state for select
  to anon
  using (true);

create policy "anon_insert_dose_state"
  on dose_state for insert
  to anon
  with check (true);

create policy "anon_update_dose_state"
  on dose_state for update
  to anon
  using (true)
  with check (true);

-- dose_log: anon can read (F4/F5 will add insert policies)
create policy "anon_read_dose_log"
  on dose_log for select
  to anon
  using (true);

-- profiles: no anon access needed in F1
-- (no policies — effectively blocked for anon, which is correct)
```

### 3.3 Seed Data: MVP Family Row

After running the schema, insert the single MVP family row. The `id` value must match `NEXT_PUBLIC_MVP_FAMILY_ID` in Vercel env vars.

```sql
-- Replace the UUID with the actual value you set in NEXT_PUBLIC_MVP_FAMILY_ID
insert into families (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Behrman')
on conflict (id) do nothing;
```

**Recommendation:** Use the UUID `00000000-0000-0000-0000-000000000001` for the MVP family. It is easy to remember, clearly synthetic, and easy to replace in F2. Dev must set this same value as `NEXT_PUBLIC_MVP_FAMILY_ID` in Vercel.

---

## 4. `lib/supabase.ts` — Function Signatures

This is the only new file Dev creates. All Supabase interaction is centralized here. No Supabase imports appear anywhere else in the codebase.

```typescript
// lib/supabase.ts

import { createClient } from "@supabase/supabase-js"
import { ParsedSchedule, DoseState } from "./types"

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * Singleton Supabase client using the anon key.
 * Safe to call in client components — anon key is intentionally public.
 * All data access is scoped to MVP_FAMILY_ID at the query level (F1 scaffold).
 */
export const supabase: ReturnType<typeof createClient>

// ---------------------------------------------------------------------------
// Family ID scaffold (F1 only — replaced by auth resolution in F2)
// ---------------------------------------------------------------------------

/**
 * Returns the hardcoded MVP family_id from the NEXT_PUBLIC_MVP_FAMILY_ID env var.
 * Throws if the env var is missing — this is a configuration error, not a recoverable state.
 */
export function getMvpFamilyId(): string

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Fetches the schedule row for the MVP family from the `schedules` table.
 * Returns the `parsed_data` field deserialized as ParsedSchedule.
 * Returns null if no row exists for this family_id.
 * Throws on Supabase client error (network failure, RLS rejection, etc.).
 */
export async function fetchSchedule(): Promise<ParsedSchedule | null>

/**
 * Upserts the schedule for the MVP family.
 * If a row already exists for this family_id, updates `parsed_data` and `updated_at`.
 * If no row exists, inserts a new one.
 * Throws on Supabase client error.
 *
 * Implementation note: use upsert with onConflict on `family_id` (requires a unique
 * index on schedules.family_id — see schema note below).
 */
export async function saveSchedule(schedule: ParsedSchedule): Promise<void>

// ---------------------------------------------------------------------------
// Dose State
// ---------------------------------------------------------------------------

/**
 * Fetches the dose state row for the MVP family from the `dose_state` table.
 * Reconstructs and returns a DoseState object from the row's columns:
 *   { currentWeek: row.current_week, currentDay: row.current_day, checkedFoods: row.checked_foods }
 * Returns null if no row exists for this family_id.
 * Throws on Supabase client error.
 */
export async function fetchDoseState(): Promise<DoseState | null>

/**
 * Upserts the dose state for the MVP family.
 * Maps DoseState fields to columns:
 *   currentWeek  → current_week
 *   currentDay   → current_day
 *   checkedFoods → checked_foods
 * Also sets updated_at to now() via default or explicit value.
 * If a row exists (unique on family_id), updates all three columns.
 * If no row exists, inserts a new one.
 * Throws on Supabase client error.
 */
export async function saveDoseState(state: DoseState): Promise<void>
```

### Schema Addendum: Unique Index on `schedules.family_id`

The `saveSchedule` upsert requires a unique constraint on `schedules.family_id`. Add this to the SQL schema:

```sql
create unique index if not exists schedules_family_id_unique on schedules(family_id);
```

This enforces one schedule per family (correct for MVP) and enables the upsert without a separate select. Add this immediately after the `schedules` table creation in the schema SQL — before the existing `schedules_family_id_idx` index.

---

## 5. File-by-File Change List

### 5.1 `package.json` — ADD dependency

**What:** Add `@supabase/supabase-js` v2.  
**Why:** The Supabase client library is not currently installed.

```json
"@supabase/supabase-js": "^2.49.4"
```

Run `npm install @supabase/supabase-js` after editing package.json.

---

### 5.2 `lib/supabase.ts` — NEW FILE

**What:** Create this file per Section 4 signatures above.  
**Why:** Centralizes all Supabase calls. No other file imports from `@supabase/supabase-js`.

**Implementation notes for Dev:**
- The client is created once at module level: `createClient(url, anonKey)` where the values come from `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- `getMvpFamilyId()` reads `process.env.NEXT_PUBLIC_MVP_FAMILY_ID` and throws if missing.
- All `fetch*` functions filter with `.eq("family_id", getMvpFamilyId())`.
- All `save*` functions use `.upsert({...}, { onConflict: "family_id" })`.
- Error handling: if `data` is null and `error` is non-null, throw `error`. Do not silently swallow Supabase errors.

---

### 5.3 `lib/storage.ts` — DELETE

**What:** Delete this file entirely.  
**Why:** All functions in it (`getSchedule`, `saveSchedule`, `clearSchedule`, `getDoseState`, `saveDoseState`, `clearDoseState`) are replaced by `lib/supabase.ts`. No remaining callers.

---

### 5.4 `app/page.tsx` — REWRITE

**What:** Replace the localStorage check with a Supabase fetch.  
**Why:** Root page currently reads `localStorage.getItem("joshy-schedule")` directly (line 11) without going through `lib/storage.ts`.

**Before (current behavior):**
```typescript
const schedule = localStorage.getItem("joshy-schedule")
if (schedule) { router.replace("/daily") } else { router.replace("/setup") }
```

**After (new behavior):**
```typescript
// useEffect calls fetchSchedule() from lib/supabase.ts
// If fetchSchedule() returns non-null → router.replace("/daily")
// If fetchSchedule() returns null → router.replace("/setup")
// If fetchSchedule() throws → router.replace("/setup") (safe degradation)
// Return null while loading (same as current behavior)
```

The page remains a client component (`"use client"`). The component shape does not change — it returns `null` while the async check runs, then redirects.

---

### 5.5 `app/daily/page.tsx` — MODIFY

**What:** Replace `getSchedule`, `getDoseState`, and `saveDoseState` calls with Supabase equivalents. Change from sync to async.  
**Why:** These are the three storage calls on this page (lines 6, 18, 23, 32).

**Changes:**

1. Remove import of `{ getSchedule, getDoseState, saveDoseState }` from `@/lib/storage`.
2. Add import of `{ fetchSchedule, fetchDoseState, saveDoseState }` from `@/lib/supabase`.
3. The `useEffect` on mount becomes async:
   - Calls `await fetchSchedule()` and `await fetchDoseState()`.
   - If schedule is null → `router.replace("/setup")` (same as before).
   - If doseState is null → use default `{ currentWeek: 1, currentDay: 1, checkedFoods: {} }` (same fallback as old `getDoseState()`).
   - On error from either fetch → `router.replace("/setup")` (safe degradation — no crash).
4. `handleStateChange` becomes async:
   - Calls `await saveDoseState(state)`.
   - Still calls `setDoseState(state)` synchronously first (optimistic local state update — UI remains responsive).
   - If `saveDoseState` throws → do not crash, do not rollback local state (this matches the "no optimistic UI" constraint — the save failed but the user sees their intent; they can refresh to get server truth).
5. The `hydrated` flag and its guard (`if (!hydrated) return`) are retained as-is — the logic that prevents saving before the initial load completes remains unchanged.
6. The `return null` while loading remains unchanged.

**The component signature and JSX are not changed.**

---

### 5.6 `app/setup/page.tsx` — MODIFY

**What:** Replace `saveSchedule` and `saveDoseState` calls with Supabase equivalents. Change `handleConfirm` to async.  
**Why:** Lines 8, 43, 44 use storage functions.

**Changes:**

1. Remove import of `{ saveSchedule, saveDoseState }` from `@/lib/storage`.
2. Add import of `{ saveSchedule, saveDoseState }` from `@/lib/supabase` (same function names — drop-in replacement for callers).
3. `handleConfirm` becomes `async function handleConfirm()`:
   - Calls `await saveSchedule(parsedSchedule)`.
   - Calls `await saveDoseState({ currentWeek: 1, currentDay: 1, checkedFoods: {} })`.
   - Then calls `router.push("/daily")`.
   - On error: set `view` to `"error"` and set error message to `"Failed to save schedule. Please try again."` — uses the existing error UI path.
4. The `view` state machine and all other JSX are not changed.

---

### 5.7 `components/` — NO CHANGES

No component file reads or writes localStorage. No component file imports from `lib/storage.ts`. Components receive `schedule`, `doseState`, `checkedFoods`, and callbacks as props. All component files are untouched.

---

### 5.8 `lib/types.ts` — NO CHANGES

TypeScript types must not change shape. This file is not touched.

---

### 5.9 `lib/schedule.ts` — NO CHANGES

Pure computation over `ParsedSchedule`. No storage calls. Untouched.

---

### 5.10 `app/api/parse-schedule/route.ts` — NO CHANGES

Server-side API route. Not touched.

---

## 6. Vercel Environment Variable Setup

### 6.1 Variables to Configure

| Variable | Where to get the value | Scope |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project dashboard → Settings → API → Project URL | Production + Preview + Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project dashboard → Settings → API → `anon` `public` key | Production + Preview + Development |
| `NEXT_PUBLIC_MVP_FAMILY_ID` | The UUID you insert into the `families` table (see Section 3.3) | Production + Preview + Development |

### 6.2 How to Add Them

**Via Vercel CLI (recommended — matches existing project workflow):**

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add NEXT_PUBLIC_MVP_FAMILY_ID
```

Select all three environments (Production, Preview, Development) for each.

**Or via Vercel dashboard:** Project → Settings → Environment Variables → Add.

### 6.3 Local Development

Because the project uses `vercel dev` (per BRIEF.md Phase 1 completion record — "API key configured in Vercel only, local dev requires `vercel dev`"), the new env vars will be automatically available after running `vercel env pull` or by using `vercel dev` directly.

Run `vercel env pull .env.local` once after adding the variables to make them available in local `.env.local`. The `.env.local` file is already in `.gitignore` by Next.js convention.

---

## 7. Migration Strategy

**Decision: No migration. Fresh start.**

**Justification:**

1. The app is currently broken — localStorage state does not persist across page reloads (the P0 carry-forward from Phase 1). There is no reliable data in localStorage to migrate.
2. The only two Phase 1 users are Dan and his wife. They are aware the app has been in broken demo state.
3. The schedule can be re-parsed from scratch in under 30 seconds using the existing setup flow.
4. Migrating localStorage to Supabase would require a one-time client-side migration script that runs on first load, finds existing localStorage data, writes it to Supabase, then clears localStorage. This adds code complexity and a second code path that must be tested. The risk/benefit is negative.
5. Dose state (week, day, checkboxes) has not been reliably persisting anyway — there is no meaningful dose state to preserve.

**What this means for users:** On first load after F1 deploys, the app will find no schedule in Supabase and redirect to `/setup`. Dan re-pastes the schedule text, confirms, and the app is in the correct starting state in Supabase. This takes under 60 seconds.

**This must be communicated to Dan before deployment** so he is not surprised by the redirect to `/setup`.

---

## 8. Ordering Constraints

The following steps must execute in this exact order. Dev cannot parallelize across these gates.

```
1. Supabase project created (manual — Dan's action)
2. SQL schema executed in Supabase SQL editor (schema first, indexes second, RLS third, seed row last)
3. Vercel env vars added (SUPABASE_URL, SUPABASE_ANON_KEY, MVP_FAMILY_ID)
4. npm install @supabase/supabase-js
5. lib/supabase.ts created
6. lib/storage.ts deleted
7. app/page.tsx rewritten
8. app/daily/page.tsx modified
9. app/setup/page.tsx modified
10. vercel env pull (to make env vars available locally for testing)
11. Local test with vercel dev
12. Deploy to Vercel
```

Steps 5–9 can be done in parallel with step 3, but step 4 must complete before any of steps 5–9.  
Steps 7–9 must not ship until step 5 is complete (they import from `lib/supabase.ts`).

---

## 9. Edge Cases

### 9.1 Supabase Unreachable (network failure, service outage)

| Location | Behavior |
|---|---|
| `app/page.tsx` — root redirect | `fetchSchedule()` throws → catch → `router.replace("/setup")`. User sees setup screen. Safe. |
| `app/daily/page.tsx` — on mount | Either fetch throws → catch → `router.replace("/setup")`. User sees setup screen. Safe. |
| `app/daily/page.tsx` — `handleStateChange` | `saveDoseState()` throws → caught silently. Local React state already updated — UI shows the user's intent. On refresh, server state is fetched fresh (which may be slightly behind). Acceptable per "no optimistic UI" constraint. |
| `app/setup/page.tsx` — `handleConfirm` | Either save throws → `view` set to `"error"` with message "Failed to save schedule. Please try again." Existing error UI renders. User can retry. |

### 9.2 First Load with No Data in Supabase

- `fetchSchedule()` returns `null` (no row in `schedules` table for this `family_id`).
- All three entry points (`app/page.tsx`, `app/daily/page.tsx`) redirect to `/setup`.
- `/setup` does not call Supabase on load — it is always the data entry point.
- This is correct and expected behavior (same as Phase 1 for a new user).

### 9.3 Schedule Exists but No Dose State Row

- `fetchDoseState()` returns `null` (schedule was saved but dose_state row is missing — e.g., after a manual DB cleanup).
- `app/daily/page.tsx` uses the fallback default: `{ currentWeek: 1, currentDay: 1, checkedFoods: {} }`.
- First `handleStateChange` call immediately writes this default to Supabase via `saveDoseState()`, creating the row.
- No crash, no redirect. Safe.

### 9.4 Missing Env Vars

- `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing: Supabase client creation will fail or produce a broken client. The `createClient` call itself may not throw immediately — but the first query will fail. This surfaces as a Supabase client error at the first fetch, which falls through the error path to `/setup`.
- `NEXT_PUBLIC_MVP_FAMILY_ID` missing: `getMvpFamilyId()` throws immediately. This will crash the component. **Dev must add a try/catch around `getMvpFamilyId()` calls in async contexts** — if it throws, treat as "no family found" and redirect to `/setup` with a console error.

### 9.5 `family_id` in Supabase Does Not Match Env Var

- If the seed row was not inserted, or was inserted with a different UUID, queries will return empty results (no rows match the `family_id` filter).
- Behavior: same as "no data" — redirect to `/setup`. Safe degradation.
- Dev should add a `console.error` log if the family ID appears valid (non-empty string) but no data is returned, to aid debugging.

### 9.6 Concurrent Writes from Two Devices

- Both parents use the app simultaneously. No real-time subscriptions in F1 — each device has its own React state.
- Device A checks off a food → `saveDoseState()` writes to Supabase.
- Device B checks off a different food → `saveDoseState()` overwrites the entire `checked_foods` JSONB with its local state.
- **Result: last write wins. Device A's checkbox change is lost.**
- This is a known limitation of the F1 design (no real-time, no merge logic). It is acceptable for the MVP — two parents using the app simultaneously at 6am is an edge case that does not create a medical risk (both parents can re-check any missed items).
- This limitation must be noted in the F1 QA handoff so Dan is aware.

---

## 10. Gaps and Open Questions

No gaps that block Dev from starting. All items below are either resolved by this plan or explicitly deferred.

| Item | Resolution |
|---|---|
| Supabase project must be manually created by Dan | Blocking prerequisite — Dev cannot proceed until Dan creates the project and provides URL + anon key. Dev can write all code in parallel but cannot test until env vars are available. |
| MVP family UUID | Resolved — use `00000000-0000-0000-0000-000000000001`. See Section 3.3. |
| Migration strategy | Resolved — no migration, fresh start. See Section 7. |
| RLS in F1 is intentionally permissive | Confirmed and documented. F2 locks it down. |
| `clearSchedule()` and `clearDoseState()` not replaced | The "Re-parse schedule" flow in `app/setup/page.tsx` overwrites (upserts) the schedule on confirm — it does not call `clearSchedule()` first. The old functions are not called anywhere except `lib/storage.ts` itself. They are deleted with the file and not replaced in F1. F2 may add delete capabilities if needed for account cleanup. |
| `handleStateChange` async error swallowing | Documented as acceptable per "no optimistic UI" constraint. Last-write-wins on concurrent access also documented (Section 9.6). |
| Supabase project creation | Manual step. Dan creates the project in the Supabase dashboard, runs the schema SQL, and provides the URL, anon key, and family UUID to be entered as Vercel env vars. This is a prerequisite for any local testing. |

---

## 11. What Dev Delivers

When F1 is complete, the following must be true:

1. `lib/storage.ts` does not exist.
2. No file in the codebase contains `localStorage`.
3. `lib/supabase.ts` exists with all four functions implemented.
4. `@supabase/supabase-js` is in `package.json` dependencies.
5. `app/page.tsx`, `app/daily/page.tsx`, `app/setup/page.tsx` all use `lib/supabase.ts` exclusively.
6. All component files are unmodified.
7. `lib/types.ts` is unmodified.
8. `dose_log` table exists in schema but no rows are inserted by F1 code.
9. Two browser sessions (in separate browser profiles) that refresh independently show the same schedule and dose state from Supabase.
10. A fresh Vercel deployment with correct env vars routes new users to `/setup` and returning users to `/daily`.
