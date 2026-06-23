# Phase 3 F3 — Recommended Foods + Medications — Design

**Date:** 2026-06-23
**Status:** Approved by Project Owner, pending implementation plan
**Ticket:** BRIEF.md → Phase 3 → F3

## Problem

The Claude API parser currently extracts three food categories (maintenance, weekly, treatment) but the plan of care document also contains recommended foods (target 3–5x/week, not daily) and daily medications (e.g. Zyrtec, Flovent) — neither is captured today. Per BRIEF.md's Schema v2, both need to be parsed, reviewable/editable before save, and displayed on a dedicated info screen separate from the daily dose view. Recommended foods additionally need a per-food weekly "given this week" counter against their target frequency.

## Scope (locked with Project Owner, 2026-06-23)

- Full F3 ticket: recommended foods **and** medications together, one pass.
- Counter resets on the app's protocol week (the calendar-anchored week from F0.1), not a calendar week — reuses the existing `getCalendarPosition` derivation, no new date logic.
- Counter supports both increment and decrement (small `−` affordance) so a misclick is correctable without waiting a week.
- Counter persistence: a JSONB column on `dose_state` (`recommended_food_counts`), following the same pattern as the existing `completed_days` column on that table — not an audit-log table, consistent with the brief's framing of this as "a simple tally, not a dose log entry."

## Data Model

**`lib/types.ts`:**
```ts
export interface RecommendedFood {
  name: string
  dose: number
  unit: string
  frequencyPerWeek: string  // e.g. "3-5" — displayed verbatim, never parsed numerically
}

export interface Medication {
  name: string
  dose: string
  unit: string
  frequency: string
}
```

`ParsedSchedule` gains `recommendedFoods?: RecommendedFood[]` and `medications?: Medication[]` — **optional**, because the existing production family's stored schedule predates this change and must continue to load without crashing until they re-parse. Every *new* parse always populates both as arrays (empty if the plan of care has none) — the parser never omits them, so downstream UI code can treat a freshly-parsed schedule's fields as always-present and only needs the optional-handling for old stored data.

`DoseState` gains `recommendedFoodCounts?: Record<string, Record<string, number>>` — outer key is the protocol week number as a string (`"3"`), inner key is food name, value is the tally for that week. A week with no entries is implicitly zero for every food — this is what makes "resets on week advance" free: there is nothing to reset, a new week number is simply an absent key.

**Migration:**
```sql
ALTER TABLE dose_state ADD COLUMN IF NOT EXISTS recommended_food_counts jsonb NOT NULL DEFAULT '{}'::jsonb;
```

## Parser

`app/api/parse-schedule/route.ts`: extend the Claude prompt to instruct extraction of `recommendedFoods` (name, dose, unit, frequencyPerWeek as a string range like "3-5") and `medications` (name, dose, unit, frequency) alongside the existing three categories. `isValidSchedule()` requires both as arrays (possibly empty) in every new parse response — this is a stricter requirement on the *API response shape* than on the *stored type*, which stays optional for backward compatibility with old rows.

## Review Screen

`components/ScheduleReview.tsx`: two new sections (Recommended Foods, Medications) using the existing `FoodReviewRow`-style inline-edit pattern (controlled inputs, local-state updater callbacks, no API calls until "Confirm & Save"). Recommended foods get name/dose/unit/frequencyPerWeek fields; medications get name/dose/unit/frequency. Both render in the same single confirm-before-save flow as the existing three categories — no separate save step.

## New Info Screen

**Route:** `app/recommended/page.tsx`. Auth-gated like every other page (`getSession()`, redirect to `/login` on failure), and requires a parsed schedule (`fetchSchedule()`, redirect to `/setup` if none — same pattern as `/daily`). Linked from the daily view's existing bottom-nav row, alongside "Dose history" and "Settings."

No daily gating on the counter — a food can be tapped any number of times on any day; the tally is purely per-protocol-week, independent of which day(s) it happened on.

**Recommended Foods section:** each row shows name, dose/unit, target frequency, and a counter `{count} / {frequencyPerWeek} this week` with a tap target to increment and a small `−` to decrement (disabled at count 0 — can never go negative). Counter is per-food, per-protocol-week.

**Medications section:** name/dose/unit/frequency, no counter — purely informational per the brief's constraint ("informational only — no checkbox tracking").

**Empty states:** if the current schedule has no recommended foods or no medications (old pre-F3 data, or a plan of care that genuinely has none), show an empty-state message per section rather than nothing/crashing.

## Counter Data Flow

1. Page load: fetch `dose_state` (need `cycleStartDate`/`skipCount` to derive the live protocol week via the existing `getCalendarPosition`, plus `recommendedFoodCounts`).
2. Compute `currentWeekKey = String(currentWeek)`.
3. Render counts from `recommendedFoodCounts[currentWeekKey]?.[foodName] ?? 0` for each recommended food.
4. Tap +/−: update local state immediately (responsive UI), debounced-save the full `recommendedFoodCounts` map via a new `saveRecommendedFoodCounts(counts)` function — same debounce pattern as the existing `saveCheckedState`, touches only the `recommended_food_counts` column, never `cycle_start_date`/`skip_count`/`current_week`/`current_day`/`floor_week`/`floor_day` (preserves the locked navigation-never-writes-position architecture from F0.1 — this is a new, independent write path that must not touch position fields).

## Edge Cases

- **Old stored schedule, no recommendedFoods/medications fields at all:** treated identically to "empty array" — empty-state message, not a crash. `ParsedSchedule.recommendedFoods` being `undefined` vs `[]` are handled the same way in the UI (`?? []`).
- **Food renamed across a re-parse:** old week's counts for the old name become orphaned in the JSONB map but are harmless — never displayed, since lookups always key off the *current* schedule's food list, not the count map's keys.
- **`frequencyPerWeek` is a string, never parsed numerically** — avoids fragile range-parsing logic for "3-5" vs "3" vs other formats the parser might produce; displayed verbatim in `"{count} / {frequencyPerWeek} this week"`.
- **Decrement below zero:** UI-disabled at 0; defensively clamp server-side too (`Math.max(0, count - 1)`) in case of a stale double-tap race.

## Testing Strategy

No test framework in this repo (consistent with prior tickets) — verification is `npx tsc --noEmit`, manual parser test against a real plan-of-care excerpt containing recommended foods and medications, and manual walkthrough of: review/edit flow for both new categories, empty-state rendering, counter increment/decrement/floor-at-zero, and week-rollover (count resets when `currentWeek` advances).
