# Stable/Maintenance Bundle — Complete Day Gate, Reset Banner, Per-Food Settings

**Status:** Approved for planning
**Source:** BRIEF.md Carry Forward — three dogfooding reports (2026-07-14) sharing one root architectural tension: treatment foods are tracked independently per-food in `treatment_food_progress` (since Phase 3.5), but several parts of the app still assume a single shared/global position.
**Scope:** Three targeted fixes, bundled at Dan's request because they share a root cause. No new tracking tables, no change to `dose_log`'s one-row-per-day model, no change to the global header's "furthest-behind food" display concept.

---

## 1. Complete Day gate wrongly requires all treatment foods checked

**Current behavior:** `EveningSection.tsx:48-50` computes `allTreatmentChecked` via `treatmentFoods.every(...)`, and the Complete Day button is `disabled={!allTreatmentChecked}`. `DailyView.tsx:141-150`'s `handleCheck` also only auto-fires `onCompleteDay()` when `schedule.treatmentFoods.every(...)` is true. So a day can only complete when 100% of treatment foods are checked.

**Root cause vs. actual requirement:** `handleCompleteDay` (`app/daily/page.tsx:214-277`) already loops food-by-food and skips any food that wasn't checked (`if (!checkedFoods[key]) continue`) — i.e. the backend already advances foods independently. The UI gate is the only thing preventing partial completion.

**Fix:**
- `EveningSection.tsx`: change `allTreatmentChecked` to `.some(...)` — at least one treatment food checked enables the button.
- `DailyView.tsx`: change the auto-fire condition in `handleCheck` to the same `.some(...)` check.
- `handleCompleteDay` itself is unchanged.
- If zero treatment foods are checked, the gate stays disabled and the day does not proceed — this is the explicit requirement, not an edge case to special-case away.

## 2. False "yesterday wasn't completed" banner after Settings reset

**Current behavior:** `app/daily/page.tsx:140-178`. On load, if `initialState.cycleStartDate < todayDateString()`, the code checks `fetchDateHasDayRecord(yesterday)` (a `dose_log` lookup by calendar date). If no record exists, it computes yesterday's week/day position from `currentWeek/currentDay - 1` and checks whether that position's foods were all checked in the `completedDays` cache. If not, it sets `previousDayIncomplete = true`, which renders the banner (`DailyView.tsx:325`).

**Root cause confirmed:** `cycleStartDateForPosition(week, day)` (`lib/schedule.ts:48`) — used by both Settings (`app/settings/page.tsx:216`) and onboarding (`app/onboarding/page.tsx:146`) — backdates `cycleStartDate` so calendar-based math lands on the chosen week/day. This makes `cycleStartDate < today` true immediately after any reset, even though there is no genuine tracked day at that backdated "yesterday." The check conflates "cycleStartDate is in the past" with "a real prior day of usage exists to evaluate."

**Fix:** Before running the yesterday check, compare yesterday's computed week/day sequence (already computed at `app/daily/page.tsx:148-150`) against `floorWeek`/`floorDay` (already part of `DoseState`, set at the same moment as any reset or onboarding — `lib/types.ts:79-80`). If yesterday's sequence position is at or before the floor position, skip the check entirely — there is no genuine prior tracked day there by definition. No new fields, no new timestamp tracking.

**Explicit non-goal:** No change to Complete Day gating logic (section 1) as part of this fix — they're related by root cause but are separate code paths.

## 3. Settings: per-food Week/Day adjuster replacing the single global stepper

**Current behavior:** `app/settings/page.tsx` has one Week stepper and one Day stepper (`week`/`day` state, `~lines 355-404`). Saving calls `saveDoseState` with `cycleStartDate: cycleStartDateForPosition(week, day)` and `resetFoodProgress(week, day)` (`lib/supabase.ts:692-714`), which resets **every** treatment food to the same position — inconsistent with the per-food tracking model in place since Phase 3.5.

**Confirmed with Dan:** there is no independent "maintenance schedule" concept. The only timeline that matters is treatment foods progressing toward 7 days at final dose before the appointment. The program's displayed "day" is always the furthest-behind treatment food's position, auto-derived — never set directly. This matches the existing `getGlobalPosition()` (`lib/schedule.ts:106-120`, min-across-foods) already used on the daily page.

**Design (confirmed via mockup, layout-v2):**
- Remove the single global Week/Day stepper entirely.
- Add a read-only "Program day (auto)" summary at the top of the Program section: `getGlobalPosition(progress)` result, with a note naming which food it's derived from (e.g. "Based on Cashew — your furthest-behind food").
- Add one stepper row per treatment food, under a "Treatment Foods" heading, same stepper visual style as today (+/− buttons). Sourced from `treatment_food_progress` via `fetchFoodProgress` (`lib/supabase.ts:633-651`).
- The food currently driving the auto-derived summary (the min) gets a small "furthest behind" tag.
- No separate maintenance/weekly adjuster of any kind. `weeklyFoods`' existing "Day 7 only" display logic is unchanged — it already reads `doseState.currentDay`, which will continue to be the derived value.
- Not a real scenario for this app: zero treatment foods with only maintenance/weekly remaining. Not building for it.

**Save behavior:**
- Editing one food's stepper calls `saveFoodProgress` (upsert, `lib/supabase.ts:653-671`) for just that food's row — never `resetFoodProgress`, which stays reserved for initial seeding only (`seedFoodProgress` at onboarding/setup parse time, where all foods legitimately start together at week 1 day 1).
- After any per-food edit, recompute `dose_state.cycleStartDate`/`floorWeek`/`floorDay` from the new derived furthest-behind position across all foods (mirrors the reconciliation `app/daily/page.tsx` already performs on load) so nav floor and calendar-based fallback stay consistent with the edited state.
- "Bulk catch-up log" (`saveBulkCatchUpLog`, `lib/supabase.ts:196-217`) now targets the post-edit auto-derived furthest-behind position instead of a manually-typed value — this preserves its existing meaning (`dose_log` is a one-row-per-calendar-day history table, not per-food).

---

## Testing (QA — all three, before Dan UI sign-off)

- **Gate:** 1-of-2 treatment foods checked → day completes, that food's position advances, the other food's position is unchanged. 0-of-2 checked → gate stays disabled, nothing advances.
- **Banner:** Settings reset today, then load daily view same day → no banner. Existing legitimate case (a real prior tracked day with no Complete Day entry) still fires it.
- **Settings:** editing one food's position leaves all other foods' positions untouched. "Program day" summary reflects the new minimum after edits. Catch-up log (if used) backfills `dose_log` to the new derived minimum, not a stale manual value.
- **Regression check:** global header's "furthest-behind food" display is unaffected — same computation, same location, just no longer independently settable in Settings.
