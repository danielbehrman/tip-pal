# Recompute Anchor Fix — Design Spec

**Date:** 2026-09-09
**Phase:** Phase 4 — Critical fix (C1) found during the Trailing Edit Redesign's final whole-branch review, before merge
**Status:** Approved by Project Owner, pending implementation plan

## Background — why this is needed

The Trailing Edit Redesign's final whole-branch review (opus-level, cross-task pass) found a Critical bug in `recomputeFoodProgressFromHistory` (`lib/schedule.ts`, added by that redesign's Task 2): it always seeds every treatment food's replay at `{week: 1, day: 1, completedDays: 0}`, then advances it only by counting checked `dose_log` days in the fetched window. That's correct only when a food's true starting position really is Week 1 Day 1. It is not, for two reachable, everyday cases:

1. **The production family this whole week's dogfooding was about** — `Peanut`/`Walnut` were seeded at Week 1 Day 3 via the New Food Cycle position stepper, not Week 1 Day 1.
2. **Any Settings per-food position correction** — `saveFoodPosition` writes an arbitrary `{week, day}` directly into `treatment_food_progress`.

The retired `floor_week`/`floor_day` field was the *only* place that recorded "this is the position the family actually declared as their starting point." `cycle_start_date` is not an equivalent substitute — it marks a back-dated calendar span for editability purposes, not an actual starting position. Once any Trailing Edit save runs the full replay, a food seeded ahead of Week 1 Day 1 (or corrected via Settings) silently rewinds toward Week 1 — changing the dose shown to a real family tracking a child's food-allergy treatment.

## Goal

Give each treatment food a persisted **anchor** — the position and calendar date it was last genuinely declared — so the replay can seed itself correctly instead of assuming Week 1 Day 1, without touching the redesign's other decisions (full-cycle edit range, no edge lock, ramp carve-out, etc.).

## Design

### Data model

Add two columns to `treatment_food_progress`, alongside the existing `week`/`day`/`completed_days`/`last_completed_at`:
- `anchor_week integer NOT NULL DEFAULT 1`
- `anchor_day integer NOT NULL DEFAULT 1`
- `anchor_date date NOT NULL DEFAULT CURRENT_DATE` (the calendar date this anchor was declared)

Existing rows (every family with treatment foods today) default to `{1, 1, <migration day>}` — for a family already at Week 1 Day 1 with no history predating this migration, this is exactly correct and produces no behavior change. For a family already mid-protocol at a non-day-1 position (the production family), the migration cannot retroactively know their true historical anchor date — see Migration Note below.

`FoodProgress` (`lib/types.ts`) gains `anchorWeek: number`, `anchorDay: number`, `anchorDate: string`.

### Write sites — who sets the anchor

The anchor is written **only** by the same events that already declare "this food's position is now X," alongside the position itself:

- `seedFoodProgress` (`lib/supabase.ts`) — used by New Food Cycle's position stepper and onboarding. Sets `anchorWeek`/`anchorDay` = the seeded `week`/`day`, `anchorDate` = today.
- Settings' `saveFoodPosition` (`app/settings/page.tsx`) — a manual per-food correction. Sets that food's anchor to the newly-chosen `week`/`day`, `anchorDate` = today.

**Never written by:** `DayEditor`'s Trailing Edit save (`recomputeFoodProgressFromHistory`'s output is persisted via `saveFoodProgress`, which must not touch anchor fields for a food it didn't just re-anchor), the backfill loop, or `handleCompleteDay`. This mirrors the already-established rule for `cycle_start_date` — routine corrections and routine advancement never move an anchor; only a genuine "declare a new starting point" action does.

### `recomputeFoodProgressFromHistory` — updated signature and behavior

```ts
export function recomputeFoodProgressFromHistory(
  schedule: ParsedSchedule,
  doseLogDays: DoseLogDay[],
  currentProgress: Map<string, FoodProgress>,
  excludeFoodNames: Set<string>
): Map<string, FoodProgress>
```

stays structurally the same, but the per-food seed changes:

- For each non-excluded food, look up its current anchor from `currentProgress.get(food.name)` — `{ anchorWeek, anchorDay, anchorDate }`. Seed `fp = { foodName, week: anchorWeek, day: anchorDay, completedDays: anchorDay - 1, lastCompletedAt: null, anchorWeek, anchorDay, anchorDate }`.
- Only replay `dose_log` entries whose date is `>= anchorDate` (not every entry in the passed-in `doseLogDays` range) — a day before the food's own anchor predates that food's declared starting point and must never count toward its position, even though it may be within the broader `[cycle_start_date, today]` editable range.
- A food with **no** entry in `currentProgress` (shouldn't happen in practice — every treatment food gets seeded) falls back to `{week: 1, day: 1, completedDays: 0}` with `anchorDate` = the earliest date in `doseLogDays`, so it degrades to today's behavior rather than throwing. **Confirmed intentional (Project Owner, 2026-09-09):** a silent degrade-safe default, not an oversight — no logging/alerting requirement added.
- Excluded (ramp-controlled) foods are unchanged: passed through from `currentProgress` verbatim, exactly as today.

### Known, accepted tradeoff — with an informational UI note (confirmed 2026-09-09)

A family can still open a day before a food's anchor (but on/after `cycle_start_date`) in Trailing Edit — History's boundary is `cycle_start_date`-based, not per-food-anchor-based, and per-food *lock* granularity was explicitly declined (Project Owner, 2026-09-09) in favor of keeping this fix scoped. Checking a box on such a day still persists to `dose_log` (so History shows what was recorded) and has no effect on that food's position, since the replay ignores dates before its anchor. This is consistent with "fill in past days" being explicitly out of scope for the parent ticket and "history is factual, never fabricated" — nothing was actually being tracked for that food before its anchor existed.

**In scope, kept minimal:** when the day being edited in `DayEditor` falls before a specific food's `anchor_date`, that food's row shows a subtle inline note (e.g. "Before tracking started for this food") — informational only, not a lock, not a confirmation dialog. The checkbox stays toggleable and still persists to `dose_log` exactly as designed above; this exists purely so a parent isn't left wondering why checking a box didn't move the day/week counter. No new prevention logic, no new dialog — just a visible reason surfaced next to the existing (unchanged) behavior, reusing the same inline-hint pattern `DayEditor` already uses for the Reaction Ramp date-range lock (`treatmentLockedHint`), just non-blocking here.

### Migration note for the current production family — **blocking pre-resume checklist item** (confirmed 2026-09-09)

The migration cannot know Peanut/Walnut's true historical anchor date retroactively — it can only default new rows going forward. Before this family resumes using Trailing Edit after this ships, the manual anchor correction for their two `treatment_food_progress` rows (`anchor_week`/`anchor_day`/`anchor_date`, set to match their actual last-known-correct starting point, verified against the family's real history) **must be applied and verified** — this is not a background follow-up note, it is a blocking item on this ticket's completion checklist. **Do not mark this ticket done until that manual correction is confirmed applied and verified.**

## Testing Strategy

- Unit tests (`lib/schedule.test.ts`) for `recomputeFoodProgressFromHistory`: a food anchored at Week 2 Day 1 with dose_log entries on/after the anchor date correctly advances from that seed (not Week 1); the same food with entries *before* its anchor date correctly ignores them; a food with no `currentProgress` entry degrades to the Week 1 Day 1 fallback without throwing; the exclude-set passthrough behavior is unchanged (regression check against Task 2's existing tests).
- Confirm `seedFoodProgress`/`saveFoodPosition` write the anchor fields alongside position, via direct Supabase query after invoking each flow.
- Regression: confirm `DayEditor`'s Trailing Edit save never writes anchor fields — read `treatment_food_progress` before and after a Trailing Edit save that changes a food's position, confirm `anchor_week`/`anchor_day`/`anchor_date` are unchanged.

## Out of Scope

- Per-food checkbox *locking* on days before that food's anchor (declined in favor of the "persists but doesn't affect position" tradeoff above) — the informational inline note is in scope; a lock/prevention mechanism is not.
- Any change to Reaction Ramp's own logic, `cycle_start_date`'s semantics, or any other part of the Trailing Edit Redesign already reviewed and approved.

## Ticket Completion Checklist

This ticket is not done until all of the following are true:
- [ ] Implementation complete, reviewed clean (migration, type/schema changes, write-site updates, recompute changes, inline UI note).
- [ ] **Production family manual anchor correction applied and verified** against Peanut/Walnut's actual history (see "Migration note" above) — blocking, not deferrable.
