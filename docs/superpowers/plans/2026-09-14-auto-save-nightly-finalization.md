# Auto-Save Daily View + Nightly Finalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Complete Day"/Skip Day/Skip Morning button model with live, per-checkbox writes and a nightly finalization job that recomputes treatment position and Reaction Ramp state from a full `dose_log` replay — closing the multi-device concurrency race a real production incident exposed on 2026-09-14.

**Architecture:** `dose_log` gains a `dose_date` identity column and a partial unique index (one row per family per real calendar day), so every checkbox tap becomes a single atomic Postgres-side JSONB merge via a new RPC function instead of a client-side read-modify-write. Treatment position is always derived by a fresh, idempotent `recomputeFoodProgressFromHistory` replay (already built, already trusted by `DayEditor`) rather than incremented from a cached snapshot; Reaction Ramp advancement moves into the same nightly pass.

**Tech Stack:** Next.js, Supabase (Postgres + `@supabase/supabase-js`), TypeScript strict, Vitest.

## Global Constraints

- TypeScript strict, no `any`.
- Test command: `npm test` (runs `vitest run`). Type-check: `npx tsc --noEmit -p .`. Build: `npm run build`.
- No code comments unless a WHY is genuinely non-obvious — match this codebase's existing sparse, purposeful comment style.
- This is real medical dosing data for a real family. No task in this plan executes a step against the production Supabase project — every production-affecting action (applying a migration that tightens a constraint, running the `dose_date` backfill script for real) is called out explicitly as a controller-only manual step, outside subagent-driven-development, exactly as `plans/RECOMPUTE-ANCHOR-FIX.md` Task 6 and `plans/TRAILING-EDIT-REDESIGN.md`'s migration-sequencing notes already establish for this project.
- `supabase-js`'s `.upsert()` cannot express a JSONB-merge `SET` clause on conflict — PostgREST upserts always replace the named columns outright with the incoming value. Anywhere this plan needs a true merge-on-conflict, it uses a Postgres function called via `.rpc()`, not `.upsert()`. Verified directly against PostgREST's upsert semantics, not assumed.
- Every new SQL function derives `family_id` server-side from the authenticated session (`SELECT family_id FROM profiles WHERE id = auth.uid()`), never accepting it as a caller-supplied parameter — matching this codebase's existing `getFamilyId()` pattern everywhere else.
- Full regression pass (`npm test`, `tsc`, `npm run build`) required before the plan's final task.

## File Structure

- `supabase/migrations/20260914_dose_log_dose_date.sql` — new. Adds nullable `dose_date`, nullable `ramp_finalized` columns to `dose_log`.
- `scripts/backfill-dose-date.js` — new. One-time Node script (dry-run by default) backfilling `dose_date` on every existing `dose_log` row from `completed_at`, using the same local-date logic already in `lib/schedule.ts`.
- `supabase/migrations/20260915_dose_log_dose_date_constraint.sql` — new. `NOT NULL` + partial unique index on `dose_date`. Deferred — apply only after the backfill script has run against production and been verified.
- `supabase/migrations/20260916_dose_log_checkbox_rpc.sql` — new. Two Postgres functions: `upsert_checked_food` (the per-key live-write merge) and `ensure_dose_log_day` (nightly finalization's gap-row creation, `DO NOTHING` on conflict).
- `lib/supabase.ts` — modify. New `upsertCheckedFood`/`ensureDoseLogDay` wrappers calling the two RPCs; `fetchDoseLogDaysInRange`/`fetchDayRecords`/`fetchEarliestDoseLogDate` rewritten to filter/key by `dose_date` instead of parsing `completed_at`; `saveSkipMorning`/`saveSkipLog` removed.
- `lib/types.ts` — modify. `DoseLogDay` gains `doseDate: string`.
- `lib/schedule.test.ts` — modify. New test coverage for the nightly finalization's day-by-day logic.
- `app/daily/page.tsx` — modify. The lazy gap-only backfill loop is rewritten into nightly finalization (runs for every day through yesterday, not just detected gaps); `handleCompleteDay`/`completingDay`/`completingDayRef`/`handleSkipMorning` removed; `handleCheck`'s persistence wired to the new live per-key RPC instead of the debounced whole-object save.
- `components/DailyView.tsx` — modify. `handleCheck` calls the new live-write path directly instead of routing through `onStateChange`'s debounce for persistence (local render state still updates the same way for instant UI feedback); `onCompleteDay`/`completingDay`/`onSkipMorning` props removed.
- `components/EveningSection.tsx` — modify. Complete Day button and Skip Morning link removed; `CompleteDayConfirm` usage removed.
- `components/CompleteDayConfirm.tsx` — deleted.
- `BRIEF.md` — modify. Final task records the redesign per this project's standard pattern.

**Files explicitly NOT touched, verified against current code, not assumed from the spec:**
- `components/DayEditor.tsx` — only ever `UPDATE`s an existing row by `id` (`updateDoseLogCheckedFoods`) and reads `treatment_food_progress`/`recomputeFoodProgressFromHistory`; never calls the removed `saveDoseLog` insert path, so a `dose_date`/uniqueness change on `dose_log` doesn't affect it.
- `components/MorningSection.tsx` — no Skip Morning trigger lives here (confirmed: it's entirely in `EveningSection.tsx`); `onCheck` wiring is unchanged, still routed through the same prop from `DailyView`.
- `lib/schedule.ts`'s `calculateBufferFromProgress` — per the spec, buffer math is left completely unchanged; no task in this plan modifies it.
- `DoseLogDay.morningSkipped`/`eveningSkipped` and their computation in `fetchDoseLogDaysInRange` — grepped, confirmed unused by any current UI. Historical `session='morning'`/`'evening'` skip rows already in the database stay queryable and untouched (history stays factual); this plan just stops creating new ones. Removing these dead fields entirely is out of scope — not requested, and touching them risks an unrelated regression for no benefit.

---

### Task 1: `dose_date` and `ramp_finalized` columns (additive, safe to apply anytime)

**Files:**
- Create: `supabase/migrations/20260914_dose_log_dose_date.sql`

**Interfaces:**
- Produces: two new nullable columns on `dose_log` (`dose_date date`, `ramp_finalized boolean`) that no code reads or writes yet — dormant until Task 6 onward ships together.

- [ ] **Step 1: Write the migration**

```sql
-- Adds dose_date as the real calendar-date identity for dose_log 'day'
-- session rows, replacing the "parse completed_at, guess the local
-- timezone" approach used throughout this codebase today. Nullable for
-- now — existing rows need a one-time backfill (scripts/backfill-dose-date.js)
-- before this can be made NOT NULL and given a uniqueness constraint (see
-- the follow-up migration, 20260915_dose_log_dose_date_constraint.sql).
--
-- ramp_finalized tracks whether nightly finalization has already applied
-- Reaction Ramp advancement for this specific day, so re-running
-- finalization (safe and idempotent for treatment position, which is a
-- full replay) doesn't double-advance a ramp step, which is NOT a replay —
-- it's incremental state. Defaults to true so every row that already
-- exists today (all of them processed under the old Complete Day model,
-- which always ran ramp advancement synchronously) is correctly treated
-- as already-finalized. New rows override this to false at insert time —
-- see Task 6.
--
-- Both columns are additive with safe defaults/nullability — no currently
-- deployed code reads or writes either one, so this is safe to apply
-- anytime regardless of when the rest of this plan ships.
ALTER TABLE dose_log
  ADD COLUMN IF NOT EXISTS dose_date date,
  ADD COLUMN IF NOT EXISTS ramp_finalized boolean NOT NULL DEFAULT true;
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: clean (no code references either column yet).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260914_dose_log_dose_date.sql
git commit -m "chore(db): add dose_log.dose_date and ramp_finalized (additive, dormant)"
```

---

### Task 2: `dose_date` backfill script (dry-run tested; production run is controller-only)

**Files:**
- Create: `scripts/backfill-dose-date.js`

**Interfaces:**
- Consumes: `formatDateOnly` from `lib/schedule.ts` (the exact function whose output must be replicated) — the script cannot reimplement this logic independently, it must import and call the real function, since even a subtly different date-boundary rule would silently misattribute historical rows.
- Produces: a script invocable as `node scripts/backfill-dose-date.js --dry-run` (default) or `node scripts/backfill-dose-date.js --apply`.

**This task produces and tests the script. It does NOT run it against production — that is an explicit controller-only step after this task, see Step 5 below, matching how `plans/RECOMPUTE-ANCHOR-FIX.md` Task 6 treats a blocking production-data action as not subagent-executable.**

- [ ] **Step 1: Write the script**

This project's static-export build already loads `.env.local` manually in `scripts/build-native.js` (Next.js env-loading isn't available to a plain Node script run outside `next build`) — follow the same pattern.

```javascript
#!/usr/bin/env node
// One-time backfill: populates dose_log.dose_date for every existing row
// from completed_at, using the exact same local-date derivation the app
// has always used to decide "which calendar day is this row for"
// (lib/schedule.ts's formatDateOnly). A raw SQL timezone cast is not safe
// here — it could silently reattribute a historical row to the wrong
// calendar day if it doesn't match what was already shown to the family.
//
// Usage:
//   node scripts/backfill-dose-date.js            (dry run — prints only)
//   node scripts/backfill-dose-date.js --apply     (writes for real)
//
// Dry-run output must be reviewed against known dates for the production
// family (00000000-0000-0000-0000-000000000001) before --apply is ever
// run against production — see this plan's Task 2 Step 5.

const path = require("path")
const fs = require("fs")
const { createClient } = require("@supabase/supabase-js")

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const vars = {}
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx < 1) continue
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
  }
  return vars
}

// Mirrors lib/schedule.ts's formatDateOnly exactly — kept in sync manually
// since this script runs outside the Next.js/TS build and can't import a
// .ts module directly. If lib/schedule.ts's formatDateOnly ever changes,
// this must change with it.
function formatDateOnly(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

async function main() {
  const root = path.join(__dirname, "..")
  const envLocal = loadEnvFile(path.join(root, ".env.local"))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || envLocal.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envLocal.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (checked process.env and .env.local)")
    process.exit(1)
  }

  const apply = process.argv.includes("--apply")
  const client = createClient(url, serviceKey)

  const { data: rows, error } = await client
    .from("dose_log")
    .select("id, completed_at, dose_date")
    .order("completed_at", { ascending: true })
  if (error) {
    console.error("Fetch failed:", error.message)
    process.exit(1)
  }

  console.log(`${rows.length} total dose_log rows. Mode: ${apply ? "APPLY" : "DRY RUN"}`)

  let updated = 0
  let skipped = 0
  for (const row of rows) {
    const computedDoseDate = formatDateOnly(new Date(row.completed_at))
    if (row.dose_date === computedDoseDate) {
      skipped++
      continue
    }
    console.log(`${row.id}: completed_at=${row.completed_at} -> dose_date=${computedDoseDate} (was ${row.dose_date ?? "null"})`)
    if (apply) {
      const { error: updateError } = await client
        .from("dose_log")
        .update({ dose_date: computedDoseDate })
        .eq("id", row.id)
      if (updateError) {
        console.error(`  FAILED to update ${row.id}:`, updateError.message)
        process.exit(1)
      }
    }
    updated++
  }

  console.log(`${apply ? "Updated" : "Would update"}: ${updated}. Already correct: ${skipped}.`)
}

main()
```

- [ ] **Step 2: Add the Supabase JS client dependency check**

Run: `grep '"@supabase/supabase-js"' package.json`
Expected: already present (this project already depends on it for `lib/supabase.ts`) — no new dependency needed.

- [ ] **Step 3: Dry-run the script against a disposable local check**

This cannot be run against production by this task. Instead, verify the script's logic is sound by running it in dry-run mode against whatever Supabase project is configured in this worktree's local `.env.local`/environment (a non-production project, or skip entirely if none is configured — in which case skip to Step 4). If run:

Run: `node scripts/backfill-dose-date.js`
Expected: prints a per-row plan with no `FAILED` lines, and does not error even if it finds zero rows to update — the script must not crash on the "no changes needed" case, or on the "table is empty" case (verify these read naturally from the code: the `for` loop over an empty `rows` array is a correct no-op).

- [ ] **Step 4: Verify by code inspection that `--apply` is not the default**

Run: `grep -n "process.argv.includes" scripts/backfill-dose-date.js`
Expected: confirms `apply` is `false` unless `--apply` is explicitly passed — the default invocation is always a dry run.

- [ ] **Step 5: Record the controller-only production step (do not perform it in this task)**

This is not a subagent-executable step — running it against production requires the same direct, verified judgment against the real family's history this project has used for every prior production data correction. Add this note to the top of `scripts/backfill-dose-date.js` (already included in Step 1's header comment above) and do not execute `--apply` against the production project as part of this task. The controller must, outside of subagent-driven-development:
1. Run `node scripts/backfill-dose-date.js` (dry run) against production and inspect its output.
2. Specifically verify the computed `dose_date` for every one of family `00000000-0000-0000-0000-000000000001`'s ("Joshy") real `dose_log` rows (the Sept 2 – Sept 14 2026 history already directly queried and confirmed correct across this project's own investigation this week) matches the calendar date already known correct for each row.
3. Only once that specific family's rows check out, run `node scripts/backfill-dose-date.js --apply` against production.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-dose-date.js
git commit -m "feat(scripts): add dose_log.dose_date backfill script (dry-run by default)"
```

---

### Task 3: `dose_date` NOT NULL + partial unique index (deferred, controller-only apply)

**Files:**
- Create: `supabase/migrations/20260915_dose_log_dose_date_constraint.sql`

**Interfaces:**
- Consumes: every `dose_log` row having a non-null `dose_date` — only true after Task 2's backfill has actually run against production.
- Produces: `dose_log_family_dose_date_day_idx`, the partial unique index Task 6's RPC function conflicts on.

- [ ] **Step 1: Write the migration**

```sql
-- Follow-up to 20260914_dose_log_dose_date.sql. Only safe to apply after
-- scripts/backfill-dose-date.js has been run with --apply against
-- production and every row confirmed to have a correct dose_date — see
-- that script's own header and this plan's Task 2 Step 5 for the required
-- verification. Applying this before the backfill completes fails
-- outright (NOT NULL against rows still null); applying it after a rushed
-- or wrong backfill would enforce uniqueness against corrupted dates.
--
-- The partial index (WHERE session = 'day') is what Task 6's
-- upsert_checked_food/ensure_dose_log_day functions conflict on — it is
-- the mechanism that makes "exactly one row per family per real calendar
-- day" an enforced database invariant, not just an application convention.
ALTER TABLE dose_log
  ALTER COLUMN dose_date SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dose_log_family_dose_date_day_idx
  ON dose_log (family_id, dose_date)
  WHERE session = 'day';
```

- [ ] **Step 2: Record the controller-only sequencing requirement**

This migration file is created and committed by this task, but **must not be applied to production until Task 2's backfill has been run and verified against production** (Task 2 Step 5). Do not apply this migration as part of this task. This is the same "additive first, tighten later, with an explicit human checkpoint in between" discipline this project has used for every prior schema change touching this family's live data (`20260910_treatment_food_progress_anchor.sql` → `20260911_food_progress_anchor_at.sql`, and `20260909_drop_navigation_floor.sql`'s deploy-ordering note).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260915_dose_log_dose_date_constraint.sql
git commit -m "chore(db): NOT NULL + partial unique index for dose_log.dose_date (apply after backfill verified)"
```

---

### Task 4: `DoseLogDay.doseDate` type + read-path rewire to `dose_date`

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/supabase.ts`

**Interfaces:**
- Consumes: `dose_date`/`ramp_finalized` columns (Task 1, dormant until this task starts reading them).
- Produces: `DoseLogDay.doseDate: string` and `DoseLogDay.rampFinalized: boolean`, consumed by later tasks (`rampFinalized` specifically by Task 8's nightly finalization loop, to know which fetched days still need ramp advancement applied).

- [ ] **Step 1: Add `doseDate` and `rampFinalized` to `DoseLogDay`**

In `lib/types.ts`:

```ts
export interface DoseLogDay {
  id: string
  week: number
  day: number
  completedAt: string
  doseDate: string
  rampFinalized: boolean
  checkedFoods: Record<string, boolean>
  scheduleSnapshot: ParsedSchedule | null
  morningSkipped: boolean
  eveningSkipped: boolean
}
```

- [ ] **Step 2: Rewrite `fetchDoseLogDaysInRange` to filter by `dose_date` directly**

In `lib/supabase.ts`, replace the existing function:

```ts
export async function fetchDoseLogDaysInRange(startDate: string, endDate: string): Promise<DoseLogDay[]> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("id, week, day, session, checked_foods, completed_at, dose_date, ramp_finalized, is_skipped, schedule_snapshot")
    .eq("family_id", familyId)
    .eq("session", "day")
    .gte("dose_date", startDate)
    .lte("dose_date", endDate)
    .order("dose_date", { ascending: false })
  if (error) throw error
  if (!data) return []
  return data.map(dayRow => ({
    id: dayRow.id as string,
    week: dayRow.week as number,
    day: dayRow.day as number,
    completedAt: dayRow.completed_at as string,
    doseDate: dayRow.dose_date as string,
    rampFinalized: dayRow.ramp_finalized as boolean,
    checkedFoods: (dayRow.checked_foods ?? {}) as Record<string, boolean>,
    scheduleSnapshot: (dayRow.schedule_snapshot ?? null) as ParsedSchedule | null,
    morningSkipped: false,
    eveningSkipped: false,
  }))
}
```

`morningSkipped`/`eveningSkipped` are set to `false` unconditionally here rather than the previous cross-referencing query against `session='morning'`/`'evening'` rows — confirmed via repo-wide grep (see this plan's File Structure section) that no current UI reads either field, so this is a safe simplification, not a silent behavior change to anything visible. Do not remove the fields from the type in this task — only the now-dead computation.

- [ ] **Step 3: Rewrite `fetchDayRecords` to key by `dose_date`-derived position, unchanged in shape**

In `lib/supabase.ts`, replace the existing function:

```ts
export async function fetchDayRecords(): Promise<Map<string, DayRecord>> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("week, day, dose_date, is_skipped, checked_foods")
    .eq("family_id", familyId)
    .eq("session", "day")
    .order("dose_date", { ascending: true })
  if (error) throw error
  const map = new Map<string, DayRecord>()
  for (const row of data ?? []) {
    // ascending order: last row per position wins (most recent) — matches
    // the pre-existing "last write wins" convention this map has always used.
    map.set(`${row.week as number}-${row.day as number}`, {
      date: row.dose_date as string,
      skipped: row.is_skipped as boolean,
      checkedFoods: (row.checked_foods ?? {}) as Record<string, boolean>,
    })
  }
  return map
}
```

- [ ] **Step 4: Rewrite `fetchEarliestDoseLogDate` to read `dose_date` directly**

In `lib/supabase.ts`, replace the existing function:

```ts
export async function fetchEarliestDoseLogDate(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("dose_log")
    .select("dose_date")
    .eq("family_id", familyId)
    .eq("session", "day")
    .order("dose_date", { ascending: true })
    .limit(1)
  if (error) throw error
  if (!data || data.length === 0) return null
  return data[0].dose_date as string
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: errors at every `DoseLogDay` construction site missing `doseDate` — list them (this is expected; fix in the next step, do not silently work around it).

- [ ] **Step 6: Fix every construction site the type-checker found**

At minimum, `lib/schedule.test.ts`'s `makeDoseLogDay` helper needs a `doseDate` default:

```ts
function makeDoseLogDay(overrides: Partial<DoseLogDay> = {}): DoseLogDay {
  return {
    id: "day-1",
    week: 1,
    day: 3,
    completedAt: "2026-09-01T12:00:00.000Z",
    doseDate: "2026-09-01",
    rampFinalized: true,
    checkedFoods: {},
    scheduleSnapshot: classifierSchedule,
    morningSkipped: false,
    eveningSkipped: false,
    ...overrides,
  }
}
```

Fix any other site `tsc` names — do not add a default anywhere the value should be a real, meaningful date instead of a placeholder.

- [ ] **Step 7: Full test suite and type-check**

Run: `npm test` then `npx tsc --noEmit -p .`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/supabase.ts lib/schedule.test.ts
git commit -m "feat(dose-log): read paths use dose_date directly instead of parsing completed_at"
```

---

### Task 5: `fetchCompletedPositions` — confirm no change needed

**Files:**
- Modify: none (verification-only task)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task exists to record that `fetchCompletedPositions` was checked and needs no change, so a later reviewer doesn't wonder why it was skipped.

- [ ] **Step 1: Confirm by reading**

`fetchCompletedPositions` (`lib/supabase.ts`) selects `week, day` only and has never touched `completed_at`/date logic at all — it answers "which positions have ever been logged," not "on what date." Confirm by running:

Run: `grep -n -A 10 "export async function fetchCompletedPositions" lib/supabase.ts`
Expected: the function body selects only `week, day`, no date column. No change needed — do not modify this function.

- [ ] **Step 2: No commit — this task makes no changes**

---

### Task 6: The two RPC functions — live per-key merge and gap-row creation

**Files:**
- Create: `supabase/migrations/20260916_dose_log_checkbox_rpc.sql`
- Modify: `lib/supabase.ts`

**Interfaces:**
- Consumes: `dose_log_family_dose_date_day_idx` (Task 3 — the migration is committed, but note this RPC migration is safe to apply to production independently and *before* Task 3's constraint is applied, since `ON CONFLICT ... WHERE session = 'day'` against a not-yet-existing partial index simply won't have a matching index to conflict on; Postgres will raise `no unique or exclusion constraint matching the ON CONFLICT specification` at the *first actual call*, not at function-creation time — so this migration itself is safe to apply anytime, but the functions won't work correctly until Task 3's index exists. Sequence Task 3 before actually wiring the app to call these in Task 8-9, not necessarily before creating the SQL functions themselves).
- Produces: `upsertCheckedFood(doseDate, key, value, week, day)`, `ensureDoseLogDay(doseDate, week, day)`, and `markRampFinalized(doseDate)` in `lib/supabase.ts`, consumed by Tasks 8-9.

- [ ] **Step 1: Write the migration**

```sql
-- Two functions backing the auto-save/nightly-finalization redesign's
-- concurrency safety. supabase-js's .upsert() cannot express a JSONB-merge
-- SET clause on conflict (PostgREST upserts always replace the named
-- columns outright) — these are real Postgres functions, called via
-- .rpc(), for the cases that need one.
--
-- Both derive family_id server-side from the authenticated session, never
-- from a caller-supplied parameter — matching every other write path in
-- this codebase (see getFamilyId() in lib/supabase.ts). A client can only
-- ever write its own family's row.
--
-- Requires dose_log_family_dose_date_day_idx (the partial unique index
-- from 20260915_dose_log_dose_date_constraint.sql) to actually succeed at
-- runtime — safe to create this function before that index exists, but it
-- will error on first real call until it does.

CREATE OR REPLACE FUNCTION upsert_checked_food(
  p_dose_date date,
  p_key text,
  p_value boolean,
  p_week integer,
  p_day integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = auth.uid();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for authenticated user';
  END IF;

  INSERT INTO dose_log (family_id, dose_date, week, day, session, checked_foods, completed_at, is_skipped, ramp_finalized)
  VALUES (v_family_id, p_dose_date, p_week, p_day, 'day', jsonb_build_object(p_key, p_value), now(), false, false)
  ON CONFLICT (family_id, dose_date) WHERE session = 'day'
  DO UPDATE SET
    checked_foods = dose_log.checked_foods || jsonb_build_object(p_key, p_value),
    completed_at = now();
END;
$$;

-- Nightly finalization's gap-fill: ensure a row exists for a calendar day
-- with zero taps, without ever overwriting a row that already has real
-- checked_foods from live writes. Plain "insert if absent" — no merge
-- needed, so DO NOTHING is correct here (unlike upsert_checked_food above).
CREATE OR REPLACE FUNCTION ensure_dose_log_day(
  p_dose_date date,
  p_week integer,
  p_day integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_family_id uuid;
BEGIN
  SELECT family_id INTO v_family_id FROM profiles WHERE id = auth.uid();
  IF v_family_id IS NULL THEN
    RAISE EXCEPTION 'No family found for authenticated user';
  END IF;

  INSERT INTO dose_log (family_id, dose_date, week, day, session, checked_foods, completed_at, is_skipped, ramp_finalized)
  VALUES (v_family_id, p_dose_date, p_week, p_day, 'day', '{}'::jsonb, now(), true, false)
  ON CONFLICT (family_id, dose_date) WHERE session = 'day'
  DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_checked_food(date, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION ensure_dose_log_day(date, integer, integer) TO authenticated;
```

- [ ] **Step 2: Add the `lib/supabase.ts` wrappers**

```ts
export async function upsertCheckedFood(
  doseDate: string,
  key: string,
  value: boolean,
  week: number,
  day: number
): Promise<void> {
  const { error } = await getClient().rpc("upsert_checked_food", {
    p_dose_date: doseDate,
    p_key: key,
    p_value: value,
    p_week: week,
    p_day: day,
  })
  if (error) throw error
}

export async function ensureDoseLogDay(doseDate: string, week: number, day: number): Promise<void> {
  const { error } = await getClient().rpc("ensure_dose_log_day", {
    p_dose_date: doseDate,
    p_week: week,
    p_day: day,
  })
  if (error) throw error
}

// Plain UPDATE, not an RPC — no merge semantics needed, this just flips
// one boolean once nightly finalization has applied ramp advancement for
// this calendar day, so a later re-run treats it as already-processed.
export async function markRampFinalized(doseDate: string): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("dose_log")
    .update({ ramp_finalized: true })
    .eq("family_id", familyId)
    .eq("dose_date", doseDate)
    .eq("session", "day")
  if (error) throw error
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: clean (nothing calls these wrappers yet).

- [ ] **Step 4: Record the RLS verification requirement (do not skip)**

`SECURITY INVOKER` means these functions run with the calling user's own permissions, so they depend on `dose_log`'s existing RLS policies permitting an authenticated user to `INSERT`/`UPDATE` a row where `family_id` matches their own profile's family — this project's Security Constraints record RLS as "deployed" for `dose_log`, but the exact policy definitions were not re-inspected while writing this plan. Before Task 8 wires the app to call these functions live, the reviewer must confirm — by calling `upsertCheckedFood` from an authenticated test session against a non-production project (or, if none exists, a disposable row in production behind the family's own real login, then deleting it) — that the RPC actually succeeds for a normal authenticated caller, not just as the service role. Do not assume this works from the SQL alone.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260916_dose_log_checkbox_rpc.sql lib/supabase.ts
git commit -m "feat(db): add upsert_checked_food/ensure_dose_log_day RPC functions"
```

---

### Task 7: `finalizeDayRamp` — pure, testable per-day ramp advancement helper

**Files:**
- Modify: `lib/schedule.ts`
- Test: `lib/schedule.test.ts`

**Interfaces:**
- Consumes: `ReactionRamp`, `advanceProgressForDay`, `resolveRampAfterAdvance` (all existing, unchanged).
- Produces: `finalizeDayRamp(schedule, checkedFoods, ramp, completedAt): { updatedRamp: ReactionRamp | null; justFinishedTreatment: boolean; finishedEntry: PreviousRamp | null }`, consumed by Task 9's nightly finalization loop.

This is the one piece of nightly finalization that genuinely needs a new pure function: treatment position is already safely re-derivable via a full `recomputeFoodProgressFromHistory` replay (idempotent, already built), but Reaction Ramp's step/`daysInStep` state is incremental, not a pure function of full history alone — it has to be advanced one real day at a time, in order, exactly like `handleCompleteDay` already does today. Extracting it here (rather than leaving it inline in `app/daily/page.tsx`) makes it independently testable and reusable between the nightly finalization loop and any other future caller.

**This is flagged as the highest-risk, most novel piece of this plan** — Reaction Ramp is clinically sensitive (clinic-prescribed step-up doses), and this session's own history shows ramp edge cases have needed multiple review rounds even for smaller changes. The task reviewer for this specific task should be dispatched at the highest available model tier and asked to hand-trace every branch against `resolveRampAfterAdvance`'s existing, already-trusted behavior — not rubber-stamp it.

- [ ] **Step 1: Write the failing tests**

Add to `lib/schedule.test.ts`, near the existing `resolveRampAfterAdvance` describe block:

```ts
describe("finalizeDayRamp", () => {
  it("returns updatedRamp: null and justFinishedTreatment: false when there is no active ramp", () => {
    const schedule = makeSchedule(["Peanut Gelatin"])
    const result = finalizeDayRamp(schedule, { "evening-Peanut Gelatin": true }, null, "2026-08-15T19:00:00.000Z")
    expect(result.updatedRamp).toBeNull()
    expect(result.justFinishedTreatment).toBe(false)
    expect(result.finishedEntry).toBeNull()
  })

  it("advances a ramp-controlled food's step when its evening checkbox was checked that day", () => {
    const schedule = makeSchedule(["Peanut Gelatin"])
    const ramp = makeRamp({
      treatmentFoods: [makeTreatmentFood({ name: "Peanut Gelatin", currentStep: 0, daysInStep: 0 })],
    })
    const result = finalizeDayRamp(schedule, { "evening-Peanut Gelatin": true }, ramp, "2026-08-15T19:00:00.000Z")
    expect(result.updatedRamp?.treatmentFoods[0]).toEqual(
      expect.objectContaining({ name: "Peanut Gelatin", currentStep: 0, daysInStep: 1, complete: false })
    )
  })

  it("leaves the ramp untouched when nothing relevant was checked that day", () => {
    const schedule = makeSchedule(["Peanut Gelatin"])
    const ramp = makeRamp({
      treatmentFoods: [makeTreatmentFood({ name: "Peanut Gelatin", currentStep: 0, daysInStep: 2 })],
    })
    const result = finalizeDayRamp(schedule, {}, ramp, "2026-08-15T19:00:00.000Z")
    expect(result.updatedRamp?.treatmentFoods[0]).toEqual(
      expect.objectContaining({ name: "Peanut Gelatin", currentStep: 0, daysInStep: 2 })
    )
    expect(result.justFinishedTreatment).toBe(false)
  })

  it("reports justFinishedTreatment and a finishedEntry when the day's advance completes the treatment side", () => {
    const schedule = makeSchedule(["Peanut Gelatin"])
    const ramp = makeRamp({
      startedAt: "2026-08-01T00:00:00.000Z",
      rampDay: 6,
      treatmentFoods: [
        makeTreatmentFood({ name: "Peanut Gelatin", currentStep: 1, daysInStep: 6, steps: [{ dose: 5, unit: "ml", days: 3 }, { dose: 10, unit: "ml", days: 7 }] }),
      ],
      maintenanceFoods: [],
    })
    const result = finalizeDayRamp(schedule, { "evening-Peanut Gelatin": true }, ramp, "2026-08-15T19:00:00.000Z")
    expect(result.justFinishedTreatment).toBe(true)
    expect(result.finishedEntry).not.toBeNull()
    expect(result.finishedEntry?.startedAt).toBe("2026-08-01T00:00:00.000Z")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- -t finalizeDayRamp`
Expected: FAIL — `finalizeDayRamp is not defined` (not yet imported/exported).

- [ ] **Step 3: Add the import to the test file**

In `lib/schedule.test.ts`, add `finalizeDayRamp` to the existing import from `./schedule`.

- [ ] **Step 4: Implement**

In `lib/schedule.ts`, add near `resolveRampAfterAdvance`:

```ts
export interface FinalizeDayRampResult {
  updatedRamp: ReactionRamp | null
  justFinishedTreatment: boolean
  finishedEntry: PreviousRamp | null
}

export function finalizeDayRamp(
  schedule: ParsedSchedule,
  checkedFoods: Record<string, boolean>,
  ramp: ReactionRamp | null,
  completedAt: string
): FinalizeDayRampResult {
  if (!ramp) return { updatedRamp: null, justFinishedTreatment: false, finishedEntry: null }

  const wasTreatmentRampActive = treatmentRampActive(ramp)
  const { updatedRampTreatmentFoods, updatedRampMaintenanceFoods } =
    advanceProgressForDay(schedule, checkedFoods, new Map(), ramp, completedAt)

  const { nextRamp, justFinishedTreatment, fullyDone } = resolveRampAfterAdvance(
    ramp, updatedRampTreatmentFoods, updatedRampMaintenanceFoods, wasTreatmentRampActive
  )

  const finishedEntry: PreviousRamp | null = justFinishedTreatment
    ? {
        startedAt: ramp.startedAt,
        endedAt: completedAt,
        rampDayCount: nextRamp.rampDay,
        treatmentFoods: nextRamp.treatmentFoods,
        maintenanceFoods: nextRamp.maintenanceFoods,
      }
    : null

  const updatedRamp = fullyDone
    ? { active: false, startedAt: "", rampDay: 0, startedAtWeek: 0, startedAtDay: 0, treatmentFoods: [], maintenanceFoods: [] }
    : nextRamp

  return { updatedRamp, justFinishedTreatment, finishedEntry }
}
```

`advanceProgressForDay` is called with an empty `Map()` for `foodProgress` here deliberately — this function's only job is the ramp side effect (`updatedRampTreatmentFoods`/`updatedRampMaintenanceFoods`), and passing a real `foodProgress` map would additionally (harmlessly, since the result is discarded) compute a treatment-position advance this function doesn't use or return. Confirm by reading `advanceProgressForDay`'s body (`lib/schedule.ts`) that it never throws or behaves differently for an empty map versus a populated one — it iterates `schedule.treatmentFoods` and does `updatedProgress.get(food.name)` with an `if (!fp) continue` guard, so an empty map is safe.

Add the needed import to `lib/types.ts` re-export or confirm `PreviousRamp` is already exported and importable in `lib/schedule.ts` — check the top of the file for its current import list before adding a duplicate.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- -t finalizeDayRamp`
Expected: PASS, 4/4.

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: all passing, no regressions to the existing 70.

- [ ] **Step 7: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "feat(schedule): extract finalizeDayRamp — pure, testable per-day ramp advancement"
```

---

### Task 8: Nightly finalization — rewrite the backfill loop in `app/daily/page.tsx`

**Files:**
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes: `ensureDoseLogDay`, `markRampFinalized`, `fetchDoseLogDaysInRange` (returning `DoseLogDay.rampFinalized`, Tasks 4 and 6), `recomputeFoodProgressFromHistory` (existing), `finalizeDayRamp` (Task 7), the existing `BannerInfo` type (unchanged).
- Produces: the app's load effect ensures every date from `cycle_start_date` through yesterday (capped at 60 days) has a `dose_log` row, then recomputes `treatment_food_progress` once via a fresh full replay and applies ramp finalization per unprocessed day (`rampFinalized === false`) in order.

This is a full rewrite of the existing lazy-backfill block (currently gated on `if (initialState.cycleStartDate <= yesterday)`), not an incremental tweak — it must now run for every day, not only ones with no existing row, and it must separate "ensure the row exists" from "has ramp been finalized for it yet" (tracked by the new `ramp_finalized` column, since treatment position is safely re-derivable from scratch every time but ramp state is not).

- [ ] **Step 1: Replace the backfill block**

In `app/daily/page.tsx`, replace the entire block from `// Lazy auto-rollover: backfill every missed day...` through the closing of that `if (initialState.cycleStartDate <= yesterday) { ... }` block (the section computing `finalDayRecords`/`finalCompletedPositions`/`banner`) with:

```ts
        // Nightly finalization: ensure every calendar day from cycle_start_date
        // through yesterday has a dose_log row (empty/unchecked if nothing was
        // ever tapped), then recompute treatment_food_progress from a fresh,
        // full replay of the actual ledger — safe to run from multiple devices
        // without coordination, since a full replay always produces the same
        // answer from the same data (see recomputeFoodProgressFromHistory).
        // Ramp advancement is NOT a replay — it's incremental state — so it's
        // applied once per not-yet-finalized day, tracked via ramp_finalized,
        // in chronological order.
        const yesterday = addDays(todayDateString(), -1)
        if (initialState.cycleStartDate <= yesterday) {
          const MAX_FINALIZE_DAYS = 60
          const earliestFinalizeDate = addDays(yesterday, -(MAX_FINALIZE_DAYS - 1))
          const rangeStart = initialState.cycleStartDate > earliestFinalizeDate ? initialState.cycleStartDate : earliestFinalizeDate

          for (let dDate = rangeStart; dDate <= yesterday; dDate = addDays(dDate, 1)) {
            const dayIndex = Math.round(
              (new Date(dDate + "T00:00:00").getTime() - new Date(initialState.cycleStartDate + "T00:00:00").getTime())
                / MS_PER_DAY
            )
            const { week: dWeek, day: dDay } = positionFromIndex(Math.max(0, dayIndex - initialState.skipCount))
            try {
              await ensureDoseLogDay(dDate, dWeek, dDay)
            } catch {
              // Ensure failed (network, etc.) — next load retries; skip ramp
              // finalization for this date this run rather than risk acting
              // on a row that may not exist.
              continue
            }
          }

          const existingDays = await fetchDoseLogDaysInRange(rangeStart, yesterday).catch(() => [])
          const unfinalizedRampDays = existingDays
            .filter(d => !d.rampFinalized)
            .sort((a, b) => (a.doseDate < b.doseDate ? -1 : a.doseDate > b.doseDate ? 1 : 0))

          let gapFirstDate: string | null = null
          let gapLastDate: string | null = null
          let gapUncheckedNames: string[] = []

          for (const entry of unfinalizedRampDays) {
            const dEveningItems = getTreatmentFoodsForWeek(s, entry.week)
            const dUncheckedNames = dEveningItems
              .filter(({ food }) => !entry.checkedFoods[`evening-${food.name}`])
              .map(({ food }) => food.name)

            if (dUncheckedNames.length > 0) {
              if (!gapFirstDate) gapFirstDate = entry.doseDate
              gapLastDate = entry.doseDate
              gapUncheckedNames = dUncheckedNames
            }

            if (ramp) {
              const recordedAt = new Date().toISOString()
              const { updatedRamp, justFinishedTreatment, finishedEntry } =
                finalizeDayRamp(s, entry.checkedFoods, ramp, recordedAt)
              if (justFinishedTreatment && finishedEntry) {
                try {
                  await appendPreviousRamp(finishedEntry)
                } catch {
                  // History write failed — non-critical
                }
              }
              if (updatedRamp) {
                ramp = updatedRamp
                try {
                  await saveReactionRamp(ramp)
                } catch {
                  // Save failed — non-critical, next load re-fetches truth
                }
              }
            }

            try {
              await markRampFinalized(entry.doseDate)
            } catch {
              // Failed to mark — the next load will re-process this same
              // day. Harmless when there's no active ramp (finalizeDayRamp
              // is a no-op), but a genuine, narrow risk when a ramp step
              // was just advanced above and only the mark-as-done write
              // failed: the next load would advance that same step again.
              // Flagged for the task reviewer rather than silently accepted
              // — a small write-ordering change (mark finalized inside the
              // same transaction as the ramp save, via a combined RPC)
              // would close this, but isn't done here to keep this task's
              // scope to what the spec actually asked for; note it as a
              // known residual gap in the final BRIEF.md writeup (Task 13).
            }
          }

          try {
            const allCycleDays = await fetchDoseLogDaysInRange(initialState.cycleStartDate, yesterday)
            progress = recomputeFoodProgressFromHistory(s, allCycleDays, progress, new Set())
            await saveFoodProgress(progress)
            globalPos = getGlobalPosition(progress)
            stateWithGlobalPos.currentWeek = globalPos.week
            stateWithGlobalPos.currentDay = globalPos.day
          } catch {
            // Recompute failed — local state still reflects whatever was
            // fetched at the top of this effect; next load retries.
          }

          const nextDayRecords = new Map(finalDayRecords)
          const nextCompletedPositions = new Set(finalCompletedPositions)
          for (const entry of existingDays) {
            const posKey = `${entry.week}-${entry.day}`
            const isSkippedEntry = getTreatmentFoodsForWeek(s, entry.week).length > 0 &&
              getTreatmentFoodsForWeek(s, entry.week).every(({ food }) => !entry.checkedFoods[`evening-${food.name}`])
            nextDayRecords.set(posKey, { date: entry.doseDate, skipped: isSkippedEntry, checkedFoods: entry.checkedFoods })
            nextCompletedPositions.add(posKey)
          }
          finalDayRecords = nextDayRecords
          finalCompletedPositions = nextCompletedPositions

          if (gapFirstDate && gapLastDate) {
            banner = gapFirstDate === gapLastDate
              ? { kind: "single", date: gapFirstDate, foods: gapUncheckedNames }
              : {
                  kind: "multi",
                  count: Math.round(
                    (new Date(gapLastDate + "T00:00:00").getTime() - new Date(gapFirstDate + "T00:00:00").getTime())
                      / (1000 * 60 * 60 * 24)
                  ) + 1,
                  startDate: gapFirstDate,
                  endDate: gapLastDate,
                }
          }
        }
```

Import `ensureDoseLogDay`, `markRampFinalized`, and `finalizeDayRamp` at the top of `app/daily/page.tsx` (from `@/lib/supabase` and `@/lib/schedule` respectively) alongside the existing imports. `DoseLogDay.rampFinalized` (Task 4) and `markRampFinalized` (Task 6) already exist by this point in the plan — this step's code uses them directly with no follow-up patch needed.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: clean.

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all passing (this task doesn't change any pure function signature already covered by tests, only `app/daily/page.tsx`'s orchestration — no new unit tests needed here beyond Task 7's).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/daily/page.tsx
git commit -m "feat(daily): nightly finalization replaces gap-only lazy backfill"
```

---

### Task 9: Live per-key checkbox writes — wire `handleCheck` to the new RPC

**Files:**
- Modify: `app/daily/page.tsx`
- Modify: `components/DailyView.tsx`

**Interfaces:**
- Consumes: `upsertCheckedFood` (Task 6).
- Produces: a new `onCheckPersist: (key: string, val: boolean) => void` callback passed from `app/daily/page.tsx` to `DailyView`, used only for the live anchor day.

- [ ] **Step 1: Add the persist handler in `app/daily/page.tsx`**

```ts
  function handleCheckPersist(key: string, val: boolean) {
    if (!hydrated || !treatmentAnchor) return
    const doseDate = todayDateString()
    upsertCheckedFood(doseDate, key, val, treatmentAnchor.week, treatmentAnchor.day).catch(() => {
      // Write failed — local state still reflects the tap; the checkbox
      // will appear checked in this session even if the server write
      // didn't land. Matches this codebase's existing fire-and-forget
      // error handling for every other live-save path (e.g. saveCheckedState).
    })
  }
```

Import `upsertCheckedFood` from `@/lib/supabase`.

- [ ] **Step 2: Pass it to `DailyView`**

Add `onCheckPersist={handleCheckPersist}` to the `<DailyView>` element's props in `app/daily/page.tsx`.

- [ ] **Step 3: Update `DailyView.tsx` to call it from `handleCheck`**

Add `onCheckPersist: (key: string, val: boolean) => void` to `DailyViewProps` and the destructured props. Replace `handleCheck`:

```ts
  function handleCheck(key: string, val: boolean) {
    onStateChange(prev => ({ ...prev, checkedFoods: { ...prev.checkedFoods, [key]: val } }))
    onCheckPersist(key, val)

    const wasChecked = !!checkedFoods[key]
    const updatedCounts = applyCrossCategoryCredit(
      schedule.recommendedFoods ?? [],
      recommendedFoodCountsRef.current,
      String(treatmentAnchor.week),
      key,
      val,
      wasChecked
    )
    if (updatedCounts) onCrossCategoryCredit(updatedCounts)
  }
```

`onStateChange` here is now purely for local render state (and `handleNavigate`'s in-session view caching) — it no longer needs to persist `checked_foods` at all, since every check now writes live via `onCheckPersist`. This makes `handleStateChange`'s debounced `saveCheckedState` call in `app/daily/page.tsx` (the `anchor`-gated one from earlier this week's fix) dead code for `checked_foods` specifically — leave `saveCheckedState`'s `completed_days` argument as-is for now (still used by `handleNavigate`'s in-session view cache), but this is worth flagging to the task reviewer: confirm `saveCheckedState` writing `checked_foods` redundantly alongside the new live per-key writes doesn't reintroduce a stale-overwrite risk (it writes the same value `handleCheck` already just persisted via `onCheckPersist`, from the same local state, so it should be idempotent — but verify this reasoning rather than trust it uninspected, since this exact class of subtle redundant-write bug is what caused this whole redesign).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: clean.

- [ ] **Step 5: Manual verification note**

This is a live-write path with no pure-function test coverage possible (it depends on component state and a network call to a Postgres RPC) — matching the spec's own Testing section. Verify by reading the diff: `onCheckPersist` is called with the exact `key`/`val` the checkbox toggle produced, targets `todayDateString()` unconditionally (correct, since checkboxes are only interactive — `disabled={isPastDay}` — for the live anchor day), and uses `treatmentAnchor.week`/`.day` (the position the row should be tagged with if this is the first tap of the day).

- [ ] **Step 6: Commit**

```bash
git add app/daily/page.tsx components/DailyView.tsx
git commit -m "feat(daily): checkbox taps write live via upsertCheckedFood, not a debounced whole-object save"
```

---

### Task 10: Remove Complete Day — button, handler, and the re-entrancy guard it required

**Files:**
- Modify: `app/daily/page.tsx`
- Modify: `components/DailyView.tsx`
- Modify: `components/EveningSection.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only deletes.

- [ ] **Step 1: Remove from `app/daily/page.tsx`**

Delete: the `handleCompleteDay` function in its entirety (including its `try`/`finally` guard block), the `completingDay`/`completingDayRef` state and ref declarations, and the `onCompleteDay={handleCompleteDay}` / `completingDay={completingDay}` props passed to `<DailyView>`.

- [ ] **Step 2: Remove from `components/DailyView.tsx`**

Delete `onCompleteDay: () => void` and `completingDay: boolean` from `DailyViewProps` and the destructured props. Remove `onCompleteDayTap={onCompleteDay}` and `completingDay={completingDay}` from the `<EveningSection>` element.

- [ ] **Step 3: Remove the button from `components/EveningSection.tsx`**

Delete the `{/* Complete Day — always enabled; confirm dialog handles partial/zero checks */}` block (the `CTAButton` instance and its wrapping `div`). Remove `onCompleteDayTap: () => void` and `completingDay: boolean` from `EveningSectionProps` and the destructured props. Remove the `handleCompleteDayTap`/`handleConfirm`/`showConfirm` state and functions, and the `uncheckedTreatmentFoods` computation that only existed to feed the confirm dialog's copy (`CompleteDayConfirm` itself is removed in Task 12 — do not delete the `<CompleteDayConfirm>` JSX block or its import yet if Task 11 hasn't run; if executing tasks in order, `showConfirm`/`CompleteDayConfirm` usage is fully removed together in this step since it's entirely a Complete Day artifact — do not defer it to Task 12, which only deletes the now-unused component file itself).

After this step, `EveningSection.tsx`'s `showActions`-gated JSX contains only the treatment food and evening medication `FoodItem` rows — no button, no confirm sheet.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: an error in `EveningSection.tsx` if `CompleteDayConfirm` is still imported but no longer used in JSX — remove the now-dead import in this same step (`import CompleteDayConfirm from "./CompleteDayConfirm"`). The file `components/CompleteDayConfirm.tsx` itself is deleted in Task 11, not here.

- [ ] **Step 5: Full test suite and build**

Run: `npm test`, `npx tsc --noEmit -p .`, `npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add app/daily/page.tsx components/DailyView.tsx components/EveningSection.tsx
git commit -m "refactor(daily): remove Complete Day button and its re-entrancy guard"
```

---

### Task 11: Delete `CompleteDayConfirm.tsx`

**Files:**
- Delete: `components/CompleteDayConfirm.tsx`

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "CompleteDayConfirm" --include="*.tsx" --include="*.ts" .`
Expected: zero matches (Task 10 already removed the only usage and import).

- [ ] **Step 2: Delete the file**

```bash
git rm components/CompleteDayConfirm.tsx
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit -p .` then `npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: delete CompleteDayConfirm.tsx (dead since Complete Day was removed)"
```

---

### Task 12: Remove Skip Morning

**Files:**
- Modify: `app/daily/page.tsx`
- Modify: `components/DailyView.tsx`
- Modify: `components/EveningSection.tsx`
- Modify: `lib/supabase.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new — this task only deletes.

There is no separate "Skip Day" button or function in the current codebase to remove — confirmed by reading `EveningSection.tsx`/`MorningSection.tsx`/`app/daily/page.tsx`: "skipping a day" has only ever meant completing with nothing checked (`CompleteDayConfirm`'s `noneChecked` branch), which Task 10 already retired along with the rest of Complete Day. Only Skip Morning (`saveSkipMorning`, a genuinely separate, informational-only `session='morning'` log) needs removing here.

- [ ] **Step 1: Remove from `app/daily/page.tsx`**

Delete the `handleSkipMorning` function and the `onSkipMorning={handleSkipMorning}` prop passed to `<DailyView>`. Remove the now-unused `saveSkipMorning` import.

- [ ] **Step 2: Remove from `components/DailyView.tsx`**

Delete `onSkipMorning: () => void` from `DailyViewProps` and the destructured props. Remove `onSkipMorning={onSkipMorning}` from the `<EveningSection>` element.

- [ ] **Step 3: Remove from `components/EveningSection.tsx`**

Delete the `{/* Skip morning — informational log only */}` block. Remove `onSkipMorning: () => void` from `EveningSectionProps` and the destructured props.

- [ ] **Step 4: Remove `saveSkipMorning`/`saveSkipLog` from `lib/supabase.ts`**

Delete both functions. Confirm first that neither is called anywhere else:

Run: `grep -rn "saveSkipMorning\|saveSkipLog" --include="*.tsx" --include="*.ts" .`
Expected: only the definitions themselves, in `lib/supabase.ts` — no other callers. If any other caller is found, stop and report it rather than deleting a function still in use.

- [ ] **Step 5: Type-check, tests, build**

Run: `npx tsc --noEmit -p .`, `npm test`, `npm run build`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add app/daily/page.tsx components/DailyView.tsx components/EveningSection.tsx lib/supabase.ts
git commit -m "refactor(daily): remove Skip Morning — an unchecked box already means not given"
```

---

### Task 13: Final regression pass and BRIEF.md update

**Files:**
- Modify: `BRIEF.md`

- [ ] **Step 1: Full regression pass**

Run: `npm test`, `npx tsc --noEmit -p .`, `npm run build`
Expected: all clean.

- [ ] **Step 2: Repo-wide sweep for dead references**

Run: `grep -rn "handleCompleteDay\|CompleteDayConfirm\|onCompleteDay\|completingDay\|saveSkipMorning\|saveSkipLog\|onSkipMorning" --include="*.tsx" --include="*.ts" .`
Expected: zero matches.

- [ ] **Step 3: Update `BRIEF.md`**

Record this redesign under a new entry in the Phase 4 section (alongside "iOS App Store Publishing" and the Trailing Edit Redesign ticket), summarizing: the multi-device concurrency incident that motivated it, the design spec and plan file paths, what shipped (dose_date + partial unique index, the two RPC functions, live per-key writes, nightly finalization replacing gap-only backfill, Complete Day/Skip Day/Skip Morning all removed), and the still-outstanding controller-only production steps (Task 2's backfill script run, Task 3's constraint migration apply — both must happen in that order, before this branch's code is deployed, exactly like this project's established migration-sequencing discipline). Update `## Current Status` per the project's standard rule.

- [ ] **Step 4: Commit**

```bash
git add BRIEF.md
git commit -m "docs: record auto-save daily view + nightly finalization implementation"
```

---

## Deploy Sequencing (record verbatim in BRIEF.md's Task 13 entry — do not lose this)

1. Merge this branch's code — but do **not** deploy yet, since the app will call `upsertCheckedFood`/`ensureDoseLogDay`, which require Task 3's constraint to exist.
2. Controller runs Task 2's backfill script (`--apply`) against production, verified against the real family's known history first (Task 2 Step 5).
3. Controller applies Task 3's migration (`NOT NULL` + partial unique index) to production.
4. Only then deploy this branch's code. Deploying before Step 3 would have every `upsert_checked_food`/`ensure_dose_log_day` call fail at the `ON CONFLICT` clause (no matching index yet) — fail loudly, not silently corrupt data, but still a broken app for the family until sequenced correctly.
