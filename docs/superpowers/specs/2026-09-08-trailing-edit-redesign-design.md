# Trailing Edit Redesign + Re-parse Redemotion — Design Spec

**Date:** 2026-09-08
**Phase:** Phase 4 ticket — supersedes Phase 2 F6 (Trailing 3-Day Edit)
**Status:** Approved by Project Owner, pending implementation plan

## Background — why this replaces the current mechanism, not patches it

Dogfooding rounds 1-5 (2026-09-03 through 2026-09-08) found four distinct bugs in the same reconciliation subsystem — the per-food "edge-only" checkbox lock (`getFoodEdgeState`), the `floor_week`/`floor_day` position boundary, and the lazy backfill loop — each in a different write path (`DayEditor`, Settings' `saveFoodPosition`, the New Food Cycle position stepper, the backfill's own date math). Each fix uncovered the next. That pattern — not one bug, a shaky foundation — is why this is a redesign rather than a fifth patch. Full account: `BRIEF.md` Current Status, rounds 1-5, and `.superpowers/sdd/progress.md`.

Root tension being resolved: the old model tried to use a single `floor_week`/`floor_day` value for two different jobs — marking the boundary of genuinely-untracked history, and gating how far back correction/editing can reach. Whenever those two needs pulled in different directions (a food that legitimately lags behind another, a multi-day gap that needs fixing one day at a time), the floor either advanced too eagerly (permanently walling off history) or stayed too far behind (in a way nothing then explained to the user).

## Goal

Trailing Edit reaches the entire current food cycle (no day cap), edits apply only on Save with full recomputation from dose history (not just the edited day), and re-parsing a schedule is demoted from the routine correction path to a deliberately harder-to-reach edge-case tool — replaced for routine corrections by a new manual foods/doses edit screen.

## 1. Data model

**Retire `floor_week`/`floor_day` entirely.** Since the floor and `cycle_start_date` are now defined to only ever move together (on an actual New Food Cycle reset or onboarding — never Settings, never `DayEditor`), keeping them as two separately-written fields is exactly the redundancy that caused every bug this session (two things that must always agree, written in different places, occasionally forgotten in one of them).

- **New editable-boundary rule:** a `dose_log` day is editable if its date ≥ `dose_state.cycle_start_date`. No separate position-based floor.
- Migration: drop `floor_week`/`floor_day` from `dose_state`. Remove every write site (`app/daily/page.tsx`, `app/setup/page.tsx`, `app/onboarding/page.tsx`, `lib/supabase.ts`) and read site (`components/DailyView.tsx`'s `floorSeq`/`leftDisabled`, `handleNavigate`'s floor guard).
- `treatment_food_progress` (per-food `week`/`day`/`completedDays`) is unchanged in shape, but becomes fully **derived** on every Trailing Edit save (see below) rather than hand-nudged via incremental advance/regress.

## 2. Recompute-on-save (the core new mechanism)

New pure function in `lib/schedule.ts` — `recomputeFoodProgressFromHistory(schedule, doseLogDaysInCycle)`:

- Input: every `dose_log` row from `cycle_start_date` to today, sorted by date.
- For each treatment food independently: walk the days in order; each day that food's checkbox was checked advances `completedDays` (roll to next week at 7, same rollover rule as today's `advanceFoodProgress`); unchecked/absent days are skipped. Same "only checked days advance" semantics as today, computed by full replay instead of one incremental nudge per edit.
- Runs for **all** treatment foods every Trailing Edit save, not just the food(s) touched by that edit — simplest, least error-prone, and cheap (a cycle is weeks, not years).
- Output replaces `treatment_food_progress` wholesale via the existing `saveFoodProgress`. `getGlobalPosition()`/buffer recompute from that exactly as today — no new logic needed downstream.

**Unit tests** (`lib/schedule.test.ts`): multi-week rollover; a food checked non-contiguously; a food never checked at all (stays at cycle start); toggling the same day on then off (no-op, byte-identical result); the exact production scenario from round 4/5 (one food never checked, one food checked most days).

### 2a. Backfill date-assignment fix (prerequisite for section 3's promise)

The existing lazy backfill (`app/daily/page.tsx`, the "Lazy auto-rollover" block) is what creates the `dose_log` rows Trailing Edit opens — if it assigns the wrong calendar date, "any day in the cycle is editable" doesn't actually hold. Round 5 found its current date math is unsound: it computes each backfilled day's date by counting backward from "yesterday" using the *current* global position (`yesterdaySeq`/`idx` arithmetic in `app/daily/page.tsx:159-191`), which silently assumes position has advanced exactly one step per calendar day since forever. That assumption breaks the moment a cycle starts at a non-day-1 position (New Food Cycle's position stepper) — the backward count runs past the actual cycle start into the *previous* cycle's dates, either assigning wrong dates or silently colliding with old `dose_log` rows still sitting on those dates (the existence check treats any row on that date as "already logged," regardless of which cycle it belongs to).

**Fix:** replace the backward-from-yesterday computation with the existing `projectedDateForPosition(cycleStartDate, skipCount, week, day)` (`lib/schedule.ts:53-60`) — already built, already used elsewhere, deterministic regardless of when the page happens to load. Each backfilled day's date is computed directly from the cycle's own anchor, not inferred from today's position.

**Also fix:** the New Food Cycle position stepper's `seedFoodProgress` call must sync `dose_state.current_week`/`current_day` to the seeded position (matching what Settings' `saveFoodPosition` and `DayEditor`'s `commitSave` already do) — otherwise the backfill's "is there a gap to fill" check never fires at all when a cycle starts ahead of day 1 (round 5's first finding).

## 3. Trailing Edit (`DayEditor` changes)

- Any day with a `dose_log` row dated ≥ `cycle_start_date` opens in the editor (replacing the old floor + per-food edge check). Every treatment/maintenance/medication checkbox is freely toggleable in edit mode — no lock, no "edit Week X · Day Y instead" hint needed anymore (today's round-4 fix becomes dead code and is removed along with `getFoodEdgeState`/`isTreatmentRowEditable`).
- **Save is per-day** (not a multi-day batch): persists that day's `checked_foods`, runs the full-cycle recompute above, persists the resulting `treatment_food_progress`, recomputes position/buffer — same "confirm if position changes" screen as today, since a single day's correction can still ripple the global position.
- Today-tab's quick 10-day-shortcut arrow is unchanged in spirit (a bounded convenience shortcut into the same editor); only its boundary check changes from the retired floor comparison to the `cycle_start_date` date check. History calendar remains the unbounded entry point, now correctly reaching the entire current cycle instead of being implicitly (and sometimes incorrectly) bounded by a floor position.

## 4. New Food Cycle and Re-parse: shared plumbing, separate entry points

**Confirmed 2026-09-08:** these stay two distinct screens with distinct copy and placement in Settings — not merged into one destination. Both call the same underlying `archiveAndStartNewCycle` (and the same diff-review + per-food position-stepper flow) as shared plumbing, extracted so neither screen duplicates the logic:

- `app/new-cycle/page.tsx`'s current flow (paste → diff review → position stepper → confirm) is factored so its steps are reusable by a second, new route rather than copy-pasted.
- **New `/re-parse` route** replaces Settings' "Re-parse schedule" link, which currently points at `/setup` (`app/settings/page.tsx:536`) — a live bug: `/setup`'s `handleConfirm` (`app/setup/page.tsx:49-62`) does a bare `saveSchedule` + `dose_state` reset with **no** archiving to `previous_cycles`, **no** `treatment_food_progress` clear/reseed, and (soon) no `cycle_start_date`/editable-boundary update either — stale per-food position rows for possibly-renamed foods, immediately desynced from the reset position. Repointing this at the shared flow fixes that as a side effect.
- Both screens run identical mechanics; they differ only in intro copy/framing and where they sit in Settings — `/new-cycle` stays front-and-center ("your next visit changed your plan"), `/re-parse` moves deeper in Settings with heavier warning copy ("start over — only if the original parse was wrong"), per decision 5.
- `/setup` itself is untouched for genuine first-time setup (no existing schedule) — only the "re-parse over an existing schedule" case moves off of it.
- Both screens' intro copy and maintenance-food diff get Bug 1/Bug 2's fix: "all foods (treatment, maintenance, weekly) are replaced with the new plan of care" (not additive), with a "Removed" badge for maintenance foods matching treatment foods' existing diff badge.
- Bug 3 (`positionEntries` not reaching the success screen's "Starting position" row) is a one-line wiring fix in the shared success-screen component.
- **Reset alert:** confirmation screen before the archive/replace step on both, explicit copy that this resets current-cycle counters (position, checked state) but never touches `dose_log` history.

**Explicitly deferred (confirmed 2026-09-08):** the "ask what day you're on, offer to fill in past days" idea from the original session request is **out of scope for this ticket**. Declining/not-filling-in stays the only behavior — days between `cycle_start_date` and today that were never actually completed remain unlogged/blank in History, consistent with "history is factual, never fabricated." A guided historical-fill-in flow can be proposed as its own future feature if still wanted, but does not block or get built as part of this ticket.

## 5. Manual foods/doses edit screen

New Settings sub-screen, edit-existing-items-only:

- **Maintenance/weekly foods:** dose, unit, prep note — inline-editable, writes `schedules.parsed_data` directly.
- **Treatment foods:** per-week dose table (`weeks[]`) — edit dose/unit per week, add/remove a week entry. Adding/removing an entire food, or changing which foods exist, stays out of scope here — that goes through New Food Cycle or Re-parse.
- **Recommended foods / medications:** dose, unit, frequency — same inline-edit pattern.
- New `updateScheduleFoods`-style function in `lib/supabase.ts`, writing only to `schedules.parsed_data`. Never touches `dose_state`, `treatment_food_progress`, or `dose_log` — this screen only changes future-facing schedule data, never past record-keeping or position.
- Settings ordering: this screen sits above both "New food cycle" and "Re-parse schedule," as the primary/routine correction path per decision 6.

## Testing Strategy

- Unit: `recomputeFoodProgressFromHistory` (rollover, gaps, no-op double-toggle, the real Peanut/Walnut scenario from rounds 4-5).
- Unit: date-based editable-boundary check replacing `floorSeq`.
- Unit: backfill date-assignment via `projectedDateForPosition` — a cycle started at a non-day-1 position produces correct, non-colliding dates for every backfilled day (the exact round-5 production scenario); confirm `seedFoodProgress`'s `dose_state` sync unblocks the backfill's gap check.
- Integration: Trailing Edit save round-trip (toggle → save → position/buffer update; no confirmation screen when position doesn't change; confirmation screen when it does).
- Integration: `/new-cycle` and `/re-parse` both produce correct archiving, full food replacement (no additive leftovers), and correct `treatment_food_progress` reseed — verified on an account with an existing schedule (the case `/setup` got wrong).
- Regression: manual edit screen never writes to `dose_state`/`treatment_food_progress`/`dose_log`.
- Migration: `floor_week`/`floor_day` column removal — confirm no remaining references (`grep -rn "floorWeek\|floorDay\|floor_week\|floor_day"`), confirm production `dose_state` rows for both families behave equivalently under the new date-based check.

## Out of Scope

- Guided "fill in past days" flow after a non-day-1 New Food Cycle start (deferred, see section 4).
- Adding/removing entire foods via the manual edit screen (routes through New Food Cycle/Re-parse instead).
- Any change to Reaction Ramp or Travel Day Buffer logic.
- Merging `/new-cycle` and `/re-parse` into one entry point (explicitly rejected 2026-09-08 — they share plumbing, not a screen).
