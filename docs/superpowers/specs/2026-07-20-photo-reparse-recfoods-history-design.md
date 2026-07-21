# Photo Bug, Reparse Flow Gaps, Recommended Foods Logging, History Delete

**Source:** Dan's session input, "Photo Bug, Reparse Flow Gaps, Recommended Foods Logging, History Delete," delivered in a session terminated before Architect work began, re-delivered 2026-07-20. Five independent items — separate commits, separate Reviewer passes each, do not merge.

**Scope:** Bug fixes 1-2 and History delete (item 5) are in-scope for Stable/maintenance per standing mode rules. Items 3 and 4 are FEATURE-labeled; Dan explicitly approved a scoped mode exception 2026-07-20 to include them in this bundle rather than opening a new phase (see BRIEF.md Current Status).

**Architect note on item 5:** History's existing "Edit" button (`/history/edit`) is not a redundant day-viewer — it's the entry point to Trailing Edit, a feature shipped and signed off 2026-07-17 (checking a previously-unchecked treatment food within the 3-day trailing window retroactively advances that food's position). Item 5's ticket text ("remove the current Edit button's viewing behavior") would have removed Trailing Edit's only entry point days after sign-off. Confirmed with Dan: keep both, as separate controls on the same screen. See section 5.

---

## 1. Photo missing on reparse (and other non-daily) screens

**Files:** `app/new-cycle/page.tsx`

**Diagnosis (differs from ticket's assumption):** The photo is not read from stale local/onboarding state — `new-cycle/page.tsx:70` already calls `fetchChildPhotoUrl()` against the `families` table on load, identically to every other screen. The actual bug: an avatar element exists in only 1 of the reparse flow's 6 view-states (`success`, lines 416-426). The other 5 states (`confirm`, `paste`, `loading`, `review`, `confirming`, `error`) render no avatar anywhere in the header.

**Fix:** Add a small avatar (child photo or 🧒 emoji fallback, matching the existing pattern used at `onboarding/page.tsx:229-248` step 4's header) to the shared header (`new-cycle/page.tsx:150-178`), visible on every view-state. `childPhotoUrl` is already in component state from the existing fetch — no new fetch, no new query.

**No other screen is affected** — Settings and daily view already display the photo correctly (both call `fetchChildPhotoUrl()` and render it unconditionally in their headers).

---

## 2. Reparse flow has no back/exit

**Files:** `app/new-cycle/page.tsx`

**Current state:** `showBack` (line 146) is true only for `paste`/`review`. `confirm` has a separate "Cancel" link (line 168-174, calls `router.back()`). `loading`, `confirming`, `success`, `error` render nothing in that header slot.

**Fix:**
- Every view-state except `success` gets a working back/exit control in the header. `success` is the flow's terminal state — "Start dosing" (line 477-483) is its exit, matching the pattern used elsewhere (e.g. onboarding's step 4 has no back button either).
- `loading` and `confirming` are async-in-flight states. `confirming` in particular spans 4 sequential Supabase writes inside `archiveAndStartNewCycle` (families → schedules → dose_state, non-transactional — see section 3 below for the food-progress write this bundle adds as a 4th). Exiting mid-write could leave partial state. Per the existing in-flight-save pattern from the 2026-07-15 bundle (steppers disabled during save, `app/settings/page.tsx`), the back control is **visible but disabled** during `loading`/`confirming`, not hidden — consistent with "every screen has a way to exit," while not permitting an exit that could interrupt a write.
- Tapping back/exit on `paste`, `review`, or `error` discards `rawText`/`parsedSchedule`/`appointmentDate` local state and returns to `confirm` (or exits the flow entirely from `confirm` via the existing Cancel behavior) — no partial state is ever saved, since nothing is written to Supabase before `handleConfirm` runs.

---

## 3. Per-food week/day prompt at onboarding and every reparse

**Files:** `app/onboarding/page.tsx`, `app/new-cycle/page.tsx`, `lib/supabase.ts` (`seedFoodProgress`), new shared component `components/FoodPositionStepper.tsx`

**Current state (materially different from what the ticket assumed):**
- **Onboarding** step 3 (`onboarding/page.tsx:365-465`) has one global Week/Day stepper applied to every treatment food uniformly via `saveDoseState` (line 133-142). `seedFoodProgress` is never called here — actual per-food seeding happens lazily on first `daily/page.tsx` load (line 109-118), using `dose_state.currentWeek/currentDay` for **every** food identically.
- **Reparse** (`archiveAndStartNewCycle`, `lib/supabase.ts:537-602`) does not touch `treatment_food_progress` **at all** — it only resets `dose_state` to week 1/day 1. This is a latent bug: stale per-food rows from the old cycle survive a reparse in `treatment_food_progress`, and `getGlobalPosition` (`lib/schedule.ts:106-120`) reads from that table whenever it's non-empty, so a reparsed family's displayed position can silently come from the old cycle's leftover rows instead of the new reset. This bundle's fix incidentally closes that gap.

**Design:**
- Extract the per-food stepper UI already built for Settings (`app/settings/page.tsx:388-451`, inline JSX) into a shared component `components/FoodPositionStepper.tsx`. Same visual style, same clamp rules (Week min 1 no max, Day 1-7, no cross-rollover). The component takes a controlled `{ foodName, week, day }[]` list and an `onChange(foodName, week, day)` callback — it does not decide persistence mode itself.
- **Two persistence modes**, matching where each caller already sits in the write lifecycle:
  - Settings (existing, unchanged): live-write — each stepper tap calls `saveFoodPosition` → `saveFoodProgress` immediately (`app/settings/page.tsx:193-`).
  - Onboarding/reparse (new): local-state — stepper taps update local component state only; values are committed in one batch via `seedFoodProgress` at the point the flow currently writes position (onboarding: `saveAndRedirect`, line 125; reparse: end of `handleConfirm`/`archiveAndStartNewCycle`).
- `seedFoodProgress`'s signature changes from a single uniform `(foods, week, day)` pair to per-food entries: `seedFoodProgress(entries: { foodName: string; week: number; day: number }[])`. This is the function Dan named as "reserved for exactly this use" in the 2026-07-15 design doc (section 6) — it was written for uniform onboarding seeding at the time; this bundle extends it to per-food without changing its purpose (still exactly-once seeding, not a live position edit).
- **Onboarding:** step 3's single Week/Day stepper is replaced with one `FoodPositionStepper` row per treatment food from the just-parsed schedule, each defaulting to Week 1/Day 1, overridable independently. Step 4's summary card "Current position" row (line 484-487, currently one Week/Day value) becomes per-food if any food was overridden away from the default, otherwise stays as a single "Week 1, Day 1" line (all foods share the default — Dev's call on exact layout, matching Settings' "furthest behind" badge convention is the reference pattern). `saveAndRedirect` calls `seedFoodProgress` with the per-food entries instead of relying on `daily/page.tsx`'s lazy uniform seed — that lazy path becomes dead code for the onboarding case (still needed as a fallback if `seedFoodProgress` fails at onboarding time, matching the existing `try/catch` swallow pattern at `daily/page.tsx:110-118`).
- **Reparse:** after `handleConfirm`'s existing writes succeed, a new step prompts for each treatment food in the *new* schedule (both carried-over and newly-introduced foods) via the same `FoodPositionStepper`, defaulting to Week 1/Day 1. On confirm, `seedFoodProgress` is called with the per-food entries — this replaces `archiveAndStartNewCycle`'s current silent no-op on `treatment_food_progress`, and explicitly overwrites (not merges) any stale rows from the prior cycle, since `seedFoodProgress` upserts on `(family_id, food_name)`.
- **UI sign-off required from Dan before Dev starts** (mockup/screen review), per Dan's explicit instruction in the ticket — this gate happens after this design doc is approved and before the implementation plan's Dev tasks begin, not after QA.

---

## 4. Recommended foods: +/- logging replacing count-only display

**Files:** `components/RecommendedFoodsView.tsx`, `app/foods/page.tsx`, `lib/schedule.ts`, `lib/types.ts`

**Current state (also differs from the ticket's framing):** Give/undo logic, persistence (`saveRecommendedGiven`, `lib/supabase.ts:91-98`), and 0-floor clamping already exist and work — `handleGive`/`handleUndo` in `app/foods/page.tsx:56-82` are called by tapping the next-empty or last-filled pip in `PipRow` (`components/RecommendedFoodsView.tsx:16-59`). This item is a UI redesign (explicit +/− buttons replacing tap-on-pip) plus two real functional gaps:

**Gap A — weekly reset is wired to the wrong source.** `currentWeek` (`app/foods/page.tsx:17,44`) comes from `dose_state.currentWeek`, which per the 2026-07-15 bundle is the **furthest-behind** treatment food's position (`getGlobalPosition`). Dan's requirement here is the opposite driver: reset should track the **furthest-ahead** food. Add `getFurthestAheadPosition(progress: Map<string, FoodProgress>)` to `lib/schedule.ts`, mirroring `getGlobalPosition`'s structure (same `(week-1)*7+(day-1)` index) but taking the max instead of the min. `app/foods/page.tsx` fetches `treatment_food_progress` (via existing `fetchFoodProgress`) instead of relying on `dose_state.currentWeek`, and uses this new helper's result as the week key for `counts`/`saveRecommendedGiven`.

**Gap B — no "minimum reached" banner.** `RecommendedFood.frequencyPerWeek` (`lib/types.ts:32`) is a free-form string like `"3-5"`. Add a small parser (`lib/schedule.ts`, e.g. `parseFrequencyLow(freq: string): number`) that extracts the first integer — matches the format already produced by the parser (`recommendedFoods[].frequencyPerWeek` in the Schema v2 example, `"3-5"`). Banner shows at the top of `RecommendedFoodsView`'s "This week" tab when every food in `recommendedFoods` has `weekCounts[food.name] >= parseFrequencyLow(food.frequencyPerWeek)`. Exact copy is Dev's call per the ticket (meaning locked: "minimum reached for all foods this week," not maximums). Banner naturally disappears on rollover since `weekCounts` is keyed by week and resets to `{}` for a new week key (no explicit reset code needed beyond Gap A's key change already causing `weekCounts[weekKey] ?? {}` to read as empty for the new week).

**Design:**
- Replace `PipRow`'s tap-on-pip interaction with an explicit `−` / count / `+` row (same visual language as `FoodPositionStepper`/Settings steppers — reuse that button styling, not the pip-dot visual, for the interactive control). Pip dots may remain as a read-only visual summary if desired (Dev's call), but the actual +/− interaction moves to dedicated buttons for discoverability, per the ticket's explicit ask ("Add + and − controls next to every recommended food").
- `onGive`/`onUndo` callback contracts are unchanged; only their trigger (button vs. pip tap) and their `currentWeek` source (Gap A) change.
- No `recommendedFoods` schema change — `frequencyPerWeek` already carries the range, per the ticket's explicit acceptance criterion.

---

## 5. History screen: delete-selection alongside existing Trailing Edit

**Files:** `app/history/page.tsx`, `lib/supabase.ts` (new delete functions), `components/DoseHistoryLog.tsx`

**Confirmed with Dan (see Architect note above):** the existing "Edit" link to `/history/edit` (Trailing Edit, signed off 2026-07-17) is **not removed and not modified**. Delete-selection is a new, separate control added to the same `/history/page.tsx` screen.

**Design:**
- `app/history/page.tsx` header keeps the existing "Edit" link and adds a "Select" mode toggle (or a persistent "Clear all" affordance — Dev's call on exact entry pattern, e.g. a second header action or a toolbar that appears above the list).
- In select mode, `DoseHistoryLog` (or a new selection wrapper around it) renders an empty circle/checkbox per history day. Tapping toggles that day into a selected-IDs set (local component state, `Set<string>` of `DoseLogDay.id`).
- "Clear all" button clears every `dose_log` row for the family in one action, independent of the current selection.
- Deleting a selection (or Clear all) removes **only** the matching `dose_log` row(s), by `id` for a selection or by `family_id` for Clear all. Two new functions in `lib/supabase.ts`:
  - `deleteDoseLogDays(ids: string[]): Promise<void>` — `dose_log.delete().in("id", ids)`, scoped by `family_id` as well for defense-in-depth (RLS already enforces this, but explicit scoping matches the existing codebase's query style, e.g. `fetchRecentCompletedDays`).
  - `deleteAllDoseLogDays(): Promise<void>` — `dose_log.delete().eq("family_id", familyId)`.
- Neither function touches `treatment_food_progress`, `dose_state`, or any position field — confirmed with Dan as a display/record-cleanup action only. QA must verify `treatment_food_progress` is byte-for-byte unchanged after both delete paths by querying the table directly, not by inspecting the UI.
- **Single confirmation step** before any destructive delete executes (standing rule for destructive actions, same pattern as the 2026-07-15 bundle's Complete Day confirm dialog) — one dialog for a selection delete, one for Clear all, no double-confirmation.
- **UI sign-off required from Dan before Dev starts**, per the ticket, same gate timing as item 3.

---

## QA (carries through from Dan's ticket, all five items)

- Photo displays correctly on reparse (every view-state), Settings, and daily view.
- Reparse flow: every view-state has a working back/exit; `loading`/`confirming` show it disabled rather than absent; exiting from `paste`/`review`/`error` discards in-progress state with no partial Supabase write.
- Onboarding and reparse both prompt per-food week/day using the shared `FoodPositionStepper`; values seed `treatment_food_progress` correctly per food, independently, via `seedFoodProgress`'s new per-food signature. Reparse specifically must be verified to overwrite (not leave stale) prior-cycle rows.
- Recommended foods: +/− controls log correctly per food, never below 0; weekly reset verified to key off `getFurthestAheadPosition`, not `dose_state.currentWeek`; "minimum reached" banner fires only when every food's count meets `parseFrequencyLow(frequencyPerWeek)`, and reads as empty (banner gone) immediately after rollover.
- History: `/history/edit` (Trailing Edit) unchanged and still reachable; new selection-delete and Clear all both remove only the intended `dose_log` row(s); `treatment_food_progress` verified unchanged in the database (not just the UI) after both delete paths; single confirmation gates both.
