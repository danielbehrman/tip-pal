# Treatment Food Tracking Fixes — Complete Day Confirm Flow, Auto-Rollover, Reset Banner, Per-Food Settings

**Status:** ⚠️ SUPERSEDED 2026-07-16 by `2026-07-16-treatment-food-tracking-fixes-final-design.md`. Dan's final design changed section 7's resolution (bulk catch-up log is removed entirely rather than fixed with an existence check), added explicit banner copy variants for single- vs multi-day gaps, and clarified trailing edit as an update-by-date write. Kept for history only — do not plan or implement against this file.
**Supersedes:** `2026-07-15-stable-maintenance-bundle-design.md` — section 1 (Complete Day) is a materially different design (no gate, confirm-on-save dialog, new lazy auto-rollover mechanism replacing part of Day Navigation). Sections 2 and 3 below carry forward unchanged from that doc.
**Source:** Dan's session input "Treatment Food Tracking Fixes," 2026-07-15. Amends three locked Phase 2 Architecture Decisions (Day completion rule, Trailing Edit, Day navigation) — see BRIEF.md, amended same day. Removes Skip Session's evening-skip path from active spec; morning skip is unaffected.
**Scope:** Four related fixes sharing one root cause: treatment foods are tracked independently per-food in `treatment_food_progress` (since Phase 3.5), but several code paths still assumed a single shared/global position or an all-or-nothing completion gate. No new tracking tables. No change to `dose_log`'s one-row-per-calendar-day model. No change to the global header's "furthest-behind food" display concept.

---

## 1. Complete Day: confirm-on-save replaces the hard gate; Skip Evening removed

**Files:** `EveningSection.tsx`, `DailyView.tsx`, `app/daily/page.tsx` (`handleCompleteDay`, ~lines 214-277)

**Remove:**
- `allTreatmentChecked` gate (`EveningSection.tsx:48-50`) and `disabled={!allTreatmentChecked}` on the Complete Day button
- The 100%-checked auto-fire condition in `handleCheck` (`DailyView.tsx:141-150`)
- Skip Evening button/flow entirely (F5's evening-skip path). Morning skip is unaffected — stays informational-only, unchanged.

**Add — confirm dialog on Complete Day tap:**
- Compare `checked_foods` for the evening session against the full treatment food list.
- All checked → no dialog, save as normal (current `handleCompleteDay` behavior, unchanged).
- Some checked → dialog lists each unchecked food **by name**, not a count: *"[Food name] wasn't checked — skip it today?"* (repeat per unchecked food, or list all names in one dialog — Dev's call on exact layout, content is locked).
- None checked → dialog reads *"No treatment foods were given today — confirm skip?"*
- Confirm → save exactly what's checked. `handleCompleteDay`'s existing per-food loop (skips any food where `!checkedFoods[key]`) requires no change — it already does the right thing once nothing blocks it from running.
- Cancel → return to daily view unchanged, nothing saved.

## 2. Lazy auto-rollover (Day Navigation amendment)

**Files:** `app/daily/page.tsx` (extends the existing reconciliation logic at lines 140-178)

**Mechanism:** On app load, if today's date is later than the tracked position's date and no Complete Day action was taken for that prior date, retroactively finalize **only that single most recent missed day** using whatever `checked_foods` was last saved (possibly nothing), then advance position per food using the same per-food logic as section 1.

**Multi-day gap handling (confirmed with Dan):** If multiple real-world days passed with zero interaction, only the single most recent missed day is auto-finalized per load. Earlier missed days in the gap are **not** retroactively finalized — no fabricated skip records for days further back. (This matches the existing reconciliation code's current single-day-lookback behavior; it is not a new limitation introduced by this bundle.)

**Relationship to existing code:** This generalizes the reconciliation logic already at `app/daily/page.tsx:140-178`, which today only reconciles "yesterday" and only when all foods were checked (`yAllChecked`, line 154). That all-or-nothing check must become per-food-independent, consistent with section 1.

**This is the only mechanism by which a day advances without an explicit Complete Day tap** — there is no background job in this app; everything is evaluated lazily on next load.

## 3. Trailing Edit (F6) can now affect advancement

**Behavior change:** Editing a previously-unchecked treatment food within the existing 3-day trailing window retroactively advances **that food's position** from that day forward. Previously, trailing edits corrected checkbox state only, with no effect on week advancement — this is superseded.

**After any trailing edit:** re-derive `getGlobalPosition()` (furthest-behind computation across all foods), the same re-derivation that happens after a Settings per-food edit (section 4). This is how two foods that drifted out of sync from a missed dose can be brought back into sync via a trailing correction.

## 4. History (F7): show partial/skipped sessions exactly as they occurred

No schema or fetch change — this is a display-layer requirement carried over from the confirm-flow in section 1. Partial/zero-checked treatment sessions must display exactly what happened (e.g. "Cashew: skipped, Peanut: given") — do not normalize to look like full completion. Clinic relevance: 7+ consecutive days at final dose before the appointment is what matters medically, so accurate per-food history here is a correctness requirement, not cosmetic polish.

## 5. False "yesterday wasn't completed" banner after Settings reset

**Files:** `app/daily/page.tsx:140-178`, `lib/schedule.ts:48` (`cycleStartDateForPosition`)

**Root cause (confirmed):** `cycleStartDateForPosition` backdates `cycleStartDate` so calendar-based math lands on a chosen week/day after a reset. The yesterday-check at `app/daily/page.tsx:140-178` treats `cycleStartDate < today` as proof "a real prior day exists," which is false immediately after any reset.

**Fix:** Before running the yesterday check, compare yesterday's computed week/day sequence (already computed at `app/daily/page.tsx:148-150`) against `floorWeek`/`floorDay` (`lib/types.ts:79-80`, set at reset/onboarding time). If yesterday's position is at or before the floor, skip the check — no genuine prior tracked day exists there. No new fields required.

**Updated banner copy** (now also covers auto-rollover cases from sections 1-2, same trigger condition):
> "Yesterday's foods were not completed or only partially completed — if this isn't correct, go back and fix it."

## 6. Settings: per-food Week/Day adjuster replaces the single global stepper

**Files:** `app/settings/page.tsx` (~lines 355-404), `lib/supabase.ts`

**Confirmed with Dan (mockup-validated):** there is no independent "maintenance schedule" concept. The only timeline that matters is treatment foods progressing toward 7 days at final dose before the appointment. The program's displayed "day" is always the furthest-behind treatment food's position, auto-derived — never set directly.

**Remove:** single global Week/Day stepper and its `resetFoodProgress(week, day)` call on save (`lib/supabase.ts:692-714`). `resetFoodProgress`/`seedFoodProgress` remain, reserved for initial onboarding/setup seeding only, where all foods legitimately start together at week 1 day 1.

**Add:**
- Read-only "Program day (auto)" summary at top of the Program section: `getGlobalPosition(progress)` result (`lib/schedule.ts:106-120`), with a note naming the driving food (e.g. "Based on Cashew — your furthest-behind food").
- One Week/Day stepper row per treatment food under a "Treatment Foods" heading, same visual style as the current stepper, sourced from `fetchFoodProgress` (`lib/supabase.ts:633-651`).
- Small "furthest behind" tag on whichever food currently drives the auto-derived summary.
- No separate maintenance/weekly adjuster of any kind. `weeklyFoods`' existing "Day 7 only" display logic is unchanged — it already reads `doseState.currentDay`, which continues to be the derived value.
- Not a real scenario for this app: zero treatment foods with only maintenance/weekly remaining. Not building for it.

**Save behavior:**
- Editing one food's stepper calls `saveFoodProgress` (upsert, `lib/supabase.ts:653-671`) for just that food — never `resetFoodProgress`.
- After any per-food edit, recompute `dose_state.cycleStartDate`/`floorWeek`/`floorDay` from the new derived furthest-behind position (mirrors the reconciliation `app/daily/page.tsx` already performs on load).
- `saveBulkCatchUpLog` now targets the post-edit auto-derived furthest-behind position, not a manually-typed value. See section 7 for the required change to how it writes rows.

## 7. Data-integrity fix: `saveBulkCatchUpLog` must not duplicate rows auto-rollover already wrote

**Investigated and resolved during Architect review (2026-07-15) — this was the open item flagged in Dan's session input.**

**Finding:** `dose_log` has no unique constraint beyond its primary key (confirmed against the live schema — only check constraints on `day`/`week`/`session` ranges and the `family_id` foreign key). A hard uniqueness constraint on `(family_id, week, day, session)` would be **incorrect** to add: `(week, day)` legitimately repeats across reset epochs by design (there is already a documented historical case of this in BRIEF.md's Carry Forward). So DB-level dedup is the wrong tool here.

The existing reconciliation logic at `app/daily/page.tsx:140-178` (which section 2's auto-rollover extends) already guards correctly — it checks `fetchDateHasDayRecord` before writing, so auto-rollover inherits that guard for free.

`saveBulkCatchUpLog` (`lib/supabase.ts:196-217`) does not: it blind-inserts a whole `(week 1..toWeek, day 1..toDay)` range with no existence check. If auto-rollover already finalized an early position (e.g. Week 1 Day 1) on a prior load, and a later Settings catch-up run also covers that same position, it inserts a duplicate `session: 'day'` row — corrupting History (F7), which would show the same day twice.

**Fix:** `saveBulkCatchUpLog` must call `fetchCompletedPositions()` (already returns exactly the set of existing `(week, day)` pairs with `session: 'day'` for this family) and exclude any position already present from the backfill insert before writing. No schema migration required.

**Explicitly out of scope, logged separately in BRIEF.md Carry Forward:** `fetchCompletedPositions()` itself is not scoped to "since the last reset" — it returns all-time positions, which means a position completed before a Settings reset could read as already-completed immediately after a fresh reset. This affects forward-nav gating and was found during this investigation, but fixing it is a separate, larger change not requested in this bundle.

---

## Testing (QA — all items, before Dan UI sign-off)

- **Confirm dialog:** 1-of-2 treatment foods checked → dialog names the specific unchecked food → confirm → that food's position unchanged, other advances. 0-of-2 checked → dialog reads the "no treatment foods given" copy → confirm → neither position advances, day recorded as skipped. Cancel at any point → nothing saved, returns to daily view unchanged.
- **Auto-rollover:** no Complete Day tap, next-day load → prior day auto-finalizes using last-saved `checked_foods`, positions advance accordingly per food. Multi-day gap (2+ days missed) → only the single most recent day is finalized; earlier days in the gap remain unresolved, not fabricated.
- **Trailing edit:** checking a previously-unchecked food within the 3-day window advances that food's position; `getGlobalPosition()` re-derives correctly; two foods that were out of sync from a single missed dose resync if that was the only gap.
- **History:** partial/skipped days display exactly what happened (named foods, not normalized to "complete" or a bare count).
- **Banner:** fires correctly on a genuine partial/incomplete prior day (including auto-rollover-produced ones), does not fire on a same-day-as-reset load.
- **Settings:** editing one food's position leaves all other foods untouched; "Program day" summary reflects the new minimum after edit; bulk catch-up log (if used) backfills to the new derived minimum without duplicating any position auto-rollover already wrote.
- **Data integrity:** deliberately trigger auto-rollover for a position, then run Settings catch-up covering that same position — confirm no duplicate `dose_log` row is created (query the table directly, not just the UI, to verify).
- **Regression:** global header's "furthest-behind food" display is unaffected by all of the above.
