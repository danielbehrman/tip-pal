# Treatment Food Tracking Fixes — Final Design

**Status:** Approved for planning — supersedes `2026-07-15-treatment-food-tracking-fixes-design.md`
**Amends:** BRIEF.md Phase 2 Architecture Decisions — Day completion rule, Trailing Edit, Day Navigation.
Removes Skip Session's evening-skip path (morning skip unaffected). Removes bulk catch-up
backfill concept entirely.
**Principle governing this whole bundle:** History is factual, never fabricated. If a day
wasn't logged, it stays empty — no retroactive "completion" is ever written for a day the
user didn't actually act on. The only two ways a `dose_log` row for a given date gets
written are: (1) the user completes/confirms that day live, or (2) lazy auto-rollover
finalizes the single most recent missed day using its last-known checked state.

---

## 1. Complete Day: confirm-on-save replaces the hard gate; Skip Evening removed

**Files:** `EveningSection.tsx`, `DailyView.tsx`, `app/daily/page.tsx` (`handleCompleteDay`)

- Remove `allTreatmentChecked` gate and its `disabled` binding on Complete Day.
- Remove the 100%-checked auto-fire condition in `handleCheck`.
- Remove Skip Evening entirely. No skip button anywhere — skipped is a *state* a day ends
  up in (nothing checked), not an action a user takes.
- On Complete Day tap, compare `checked_foods` against the full treatment food list:
  - All checked → save normally, no dialog.
  - Some checked → dialog names each unchecked food: *"[Food name] wasn't checked — skip it today?"*
  - None checked → *"No treatment foods were given today — confirm skip?"*
- Confirm → save exactly what's checked; unchecked foods do not advance, checked foods do.
- Cancel → nothing saved, returns to daily view.
- **UI sign-off required before Dev:** dialog copy is locked (above), but layout/presentation
  needs a quick screen pass per standard rule — do not leave to Dev's discretion.

## 2. Lazy auto-rollover — single most recent missed day only

**Files:** `app/daily/page.tsx` (extends existing reconciliation at lines 140-178)

- On app load, if today is later than the tracked position's date and no Complete Day
  action was taken for that prior date: finalize **only that single most recent day**
  using whatever `checked_foods` was last saved (possibly nothing → recorded as skipped).
- Earlier days in a multi-day gap are **not** auto-finalized — they remain unlogged,
  permanently, unless the user goes back and logs them directly (see section 3).
- This is the only automatic advancement mechanism in the app — no background job exists.
- Idempotent by construction: it only acts when no `dose_log` row exists yet for that day
  (same `fetchDateHasDayRecord`-style guard the existing reconciliation code already uses),
  so re-running on a later load cannot re-finalize (or duplicate) a day it already wrote.

## 3. Trailing edit — updates the existing day, never inserts a duplicate

**Files:** trailing-edit flow (3-day window), `dose_log` writes

- Going back and checking a previously-unchecked food within the trailing window
  **updates the existing `dose_log` row for that calendar date** (one row per day, per
  the existing model) — this is an update-by-date, not an insert. No duplicate-row risk.
- That food's position advances from that day forward based on the corrected state.
- After any trailing edit, re-derive `getGlobalPosition()` (furthest-behind across all
  foods) so foods that drifted out of sync from a single missed dose can resync.
- **Gaps outside the 3-day trailing window are not fixable in-app.** This is accepted —
  matches the "factual, never fabricated" principle. Not in scope to extend the window.

**Technical note (Architect, 2026-07-16):** `dose_log` has no unique constraint (confirmed
against the live schema — only check constraints on `day`/`week`/`session` ranges and the
`family_id` foreign key), and today's only write path (`saveDoseLog`, `lib/supabase.ts:259-280`)
is a blind `.insert()`. "Update by date, not insert" is therefore a new write path, not an
existing one: look up the existing row for `(family_id, week, day, session='day')` — order
by `completed_at` descending, take the first match, to correctly land on the current epoch's
row if an older row for the same `(week, day)` exists from before a prior reset — then
`UPDATE` that row's `id` (setting `checked_foods`, `completed_at`, `is_skipped`). Do not
route trailing edits through `saveDoseLog`.

## 4. History (F7): display exactly what happened

- No schema change. Partial/skipped days display precisely as logged (e.g. "Cashew:
  skipped, Peanut: given"), including auto-rollover-produced skip days.
- Days that were never logged at all (outside the 3-day trailing window, e.g. someone
  starting mid-protocol or a multi-day gap that was never gone back and fixed) show as
  empty/absent — not backfilled, not normalized to any completion state.

## 5. Reset/gap banner — explicit, never generic

**Files:** `app/daily/page.tsx:140-178`, `lib/schedule.ts:48`

**Root cause fix (unchanged from prior doc):** compare yesterday's computed position
against `floorWeek`/`floorDay` before running any incomplete-day check — skip the check
entirely if yesterday's position is at or before the floor (no real prior day exists there).

**Two explicit copy variants — no generic message allowed:**
- **Single day gap:** *"[Date] wasn't logged — [food names] weren't given. Go back and
  fix it if that's wrong."*
- **Multi-day gap:** *"[N] days weren't logged ([start date]–[end date]). Only your
  current position is tracked going forward — go back to each day to log what actually
  happened."*

Purpose: nobody should be able to advance past an unlogged day without seeing, in plain
language, exactly which day(s) and food(s) are affected — this is what prevented the
original bug (positions silently drifting apart).

## 6. Settings: per-food adjuster — direct position update, no history backfill

**Files:** `app/settings/page.tsx` (~lines 355-404, 571+), `lib/supabase.ts`

- Remove the single global Week/Day stepper and its `resetFoodProgress(week, day)` call
  on save. `resetFoodProgress`/`seedFoodProgress` remain, reserved for initial onboarding
  seeding only.
- **Remove `saveBulkCatchUpLog` entirely** — no longer used anywhere in the app. Editing
  a food's position in Settings never writes `dose_log` rows for skipped history; it only
  updates `treatment_food_progress` for that food going forward.
- **Also remove the Catchup bottom-sheet modal** (`app/settings/page.tsx:571+`) and its
  supporting state (`showCatchup`, the `withCatchup` param on `saveAll`) — this UI exists
  solely to drive `saveBulkCatchUpLog` and has no purpose once it's gone.
- Add: read-only "Program day (auto)" summary (`getGlobalPosition(progress)`) naming the
  driving food, e.g. "Based on Cashew — your furthest-behind food."
- Add: one Week/Day stepper per treatment food under "Treatment Foods," sourced from
  `fetchFoodProgress`. Small "furthest behind" tag on whichever food drives the summary.
- No separate maintenance/weekly adjuster — `weeklyFoods`' "Day 7 only" logic unchanged.
- **Save behavior:** editing one food's stepper calls `saveFoodProgress` (upsert) for
  just that food. After any edit, recompute `dose_state.cycleStartDate`/`floorWeek`/
  `floorDay` from the new derived furthest-behind position — this moves the floor forward,
  meaning any history gap before the new floor is permanently and correctly empty (the
  user genuinely wasn't tracking those days), consistent with section 4.

## 7. Explicitly out of scope (logged in BRIEF.md Carry Forward, not fixed here)

`fetchCompletedPositions()` is not scoped to "since the last reset" — it returns
all-time positions across resets, which can affect forward-nav gating (a position
completed in a prior epoch may read as already-completed after a fresh reset). This
was found during investigation of the now-removed bulk catch-up path but is unrelated
to it — it's a separate, larger fix not requested in this bundle.

---

## Testing (QA — before Dan UI sign-off)

- **Confirm dialog:** partial checked → names the unchecked food(s) → confirm → correct
  per-food advancement. Zero checked → "no treatment foods given" copy → confirm → no
  advancement, day recorded as skipped. Cancel → nothing saved.
- **Auto-rollover:** no tap, next load → single most recent day finalizes from last-saved
  state. 2+ day gap → only the most recent finalizes; earlier days stay empty permanently.
- **Trailing edit:** correcting a day within the window updates that date's existing row
  (verify no duplicate row is created — query `dose_log` directly), advances that food,
  re-derives global position.
- **History:** skipped/partial days show exactly what happened; days outside the window
  that were never logged show as empty, not fabricated.
- **Banner:** single-day and multi-day copy variants both render correctly with accurate
  dates/food names; does not fire on same-day-as-reset load.
- **Settings:** per-food edit updates only that food, recomputes floor position correctly;
  confirm no `dose_log` rows are written by a Settings edit (query directly); Catchup
  modal and all its state/UI are fully gone, not just visually hidden.
- **Regression:** global header's "furthest-behind food" display unaffected.
