# Travel Day Buffer — Design Spec

**Date:** 2026-09-01
**Phase:** Phase 4 — Engagement
**Status:** Approved by Project Owner, pending implementation plan

## Goal

Families who fly to their clinic appointment typically build in a travel day the day before — no dosing happens that day. Today's buffer calculation doesn't know about this, so it silently overstates how many free days a family actually has. This feature lets a family flag that they travel to appointments, and automatically accounts for one additional non-dosing day in the buffer math. Pure math only — no logging, no tracking, no `dose_log` entry for the travel day itself.

## Data Model

New column on `families`:

```sql
ALTER TABLE families
  ADD COLUMN IF NOT EXISTS flies_to_appointments BOOLEAN NOT NULL DEFAULT false;
```

- Migration file: `supabase/migrations/20260901_travel_day_buffer.sql`, following the existing convention (dated filename, one-line header comment, `ADD COLUMN IF NOT EXISTS`) — same pattern as `20260813_reaction_ramp.sql`'s `ramp_active` column.
- Default `false` means every existing family (including production) keeps today's exact buffer behavior until they explicitly opt in via Settings. No backfill prompt, no banner — this is a quiet, opt-in setting change (Project Owner decision).

## Data Access (`lib/supabase.ts`)

New getter/setter pair modeled directly on `fetchAppointmentDate` / `saveAppointmentDate` (lines 196–214) — single scalar field on `families`, scoped by the existing `getFamilyId()` helper:

```ts
export async function fetchFliesToAppointments(): Promise<boolean> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("flies_to_appointments")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return data.flies_to_appointments as boolean
}

export async function saveFliesToAppointments(value: boolean): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ flies_to_appointments: value })
    .eq("id", familyId)
  if (error) throw error
}
```

## Buffer Calculation (`lib/schedule.ts`)

`calculateBufferFromProgress()` (currently lines 150–173) gains a new required parameter:

```ts
export function calculateBufferFromProgress(
  appointmentDateStr: string | null,
  totalTreatmentWeeks: number,
  slowestWeek: number,
  slowestCompletedDays: number,
  fliesToAppointments: boolean
): BufferResult
```

The existing line:

```ts
bufferDays = round((apptDate - finalDay7Date) / MS_PER_DAY) - 1  // excludes appointment day
```

becomes:

```ts
bufferDays = round((apptDate - finalDay7Date) / MS_PER_DAY) - 1 - (fliesToAppointments ? 1 : 0)
```

This applies uniformly to every `BufferResult` kind that computes a day count (`"days"` and `"behind"`). `"hidden"` (no appointment date set) and `"past"` (appointment date already elapsed) are untouched — there's no day-count math to adjust in those states. A family already showing `"behind"` with the flag on shows *more* behind by one day, which is correct: they genuinely have one fewer usable day.

All three call sites pass the flag through:
- `app/onboarding/page.tsx` (~line 161–163)
- `app/new-cycle/page.tsx` (~line 168)
- `components/DailyView.tsx` (~lines 104–113)

The flag is read live at calculation time (via the fetch/save pair above), so a Settings edit takes effect immediately, exactly like any other appointment-config change — it is not pinned to a specific food cycle.

### Call-site data flow (source of `fliesToAppointments` at each site)

The three call sites do not share one uniform sourcing pattern today for `appointmentDateStr` itself, so `fliesToAppointments` must follow each site's *existing* architecture rather than a single rule:

- **`app/onboarding/page.tsx`** — value is local component state set directly by the user in this same flow (see Onboarding section below). Not fetched.
- **`app/new-cycle/page.tsx`** — here `appointmentDate` is local state populated from the parsed-schedule API response (`data.schedule.appointmentDate`) or a direct user edit (line 62, set at lines 106–107, editable at lines 410–411) — it is **not** sourced from `fetchAppointmentDate()`/`lib/supabase.ts` at all, because the appointment date is a new fact every cycle. Whether a family flies to appointments is different: it's a standing family preference that doesn't change per cycle, not something re-entered at each new-cycle screen. So `fliesToAppointments` here must be fetched independently via a new `fetchFliesToAppointments()` call inside this file's existing `init()` `useEffect` (~lines 70–83, alongside `fetchSchedule`/`fetchChildPhotoUrl`), reflecting the family's current persisted Settings answer — not derived from the parse payload.
- **`components/DailyView.tsx`** — `appointmentDate` here is a **prop** (`DailyViewProps`, declared line 16, destructured line 70), not fetched inside `DailyView.tsx` itself — the component has no fetch calls of its own. The actual fetch happens in the parent, `app/daily/page.tsx`, inside its mount-time `Promise.all` (lines 89–100, via `fetchAppointmentDate().catch(() => null)` at line 91), stored in state (line 45), and passed down as the `appointmentDate` prop (line 429). `fliesToAppointments` must follow this exact same path: add `fetchFliesToAppointments()` to that same `Promise.all` in `app/daily/page.tsx`, store it in new state, add it to `DailyViewProps`, and pass it down as a new prop — **do not** add a fetch call inside `DailyView.tsx`, which would break its existing purely prop-driven design.
- **`app/settings/page.tsx`** — fetched directly via `fetchFliesToAppointments()` on mount (see Settings section below) — this file already fetches `appointmentDate` itself (no parent), so this one *is* a direct same-file fetch, consistent with its existing pattern.

## Onboarding (`app/onboarding/page.tsx`)

- New state: `const [fliesToAppointments, setFliesToAppointments] = useState<boolean | null>(null)` — `null` means "unanswered," distinct from an explicit `false` ("No"). This tri-state is UI-only; the persisted value is always a real boolean once saved.
- UI: added directly below the Step 2 appointment-date input. Label: "Do you travel to your appointments?" with the spec's explanatory note: *"If you fly or travel the day before, we'll automatically account for one extra skip day in your buffer calculation."* Control: a two-button Yes/No segmented pair, neither button visually selected while `fliesToAppointments === null`.
- **Required-choice enforcement (Project Owner note 1):** this is validated, not just visually unselected. `saveAndRedirect()` (lines 125–150) must check `fliesToAppointments !== null` before proceeding, following the same required-field validation pattern already used for other required onboarding fields (e.g. child name) — block advancing/saving and surface an inline validation message if the user attempts to continue without choosing Yes or No. Exact validation-trigger mechanism (disabled Continue button vs. on-submit inline error) should match whatever pattern the child-name field already uses in this file, for UI consistency — confirm during implementation.
- Step 4 summary card (lines 434–458) gets a new row: `{ label: "Travel day", value: fliesToAppointments ? "Yes" : "No" }`.
- Save: new `saveFliesToAppointments(fliesToAppointments)` call added alongside the existing `saveFamilyConfig(...)` call in `saveAndRedirect()`. Since validation guarantees non-null at this point, the call always receives a real boolean.

## Settings (`app/settings/page.tsx`)

- New state `fliesToAppointments: boolean`, loaded on mount via `fetchFliesToAppointments()` alongside the existing appointment-date load (~lines 107–109), guarded the same way (`appointmentDateLoaded`-style ref pattern).
- UI: added to the "Program" section (362–499), directly after the appointment date row (381) — new `RowDivider` + row, same white rounded-card container styling as the rest of the section.
- **Explanatory note preserved (Project Owner note 2):** the same note text used in onboarding ("If you fly or travel the day before...") is shown in Settings alongside the Yes/No control, not dropped for space. Since Settings already has an existing family answer (never `null` here — the column is `NOT NULL`), the Yes/No pair reflects the current saved value rather than starting unselected.
- Save: `saveFliesToAppointments(fliesToAppointments)` called on submit alongside the existing `saveAppointmentDate(...)` call (~lines 261–265).

## Constraints (unchanged from BRIEF)

- No `dose_log` write for the travel day — pure buffer math only.
- No skip-day logging or tracking of any kind for this flag.
- Travel day is always exactly the day immediately before the appointment (never configurable as a different offset).

## Testing

- `lib/schedule.test.ts`: new unit tests for `calculateBufferFromProgress` with `fliesToAppointments: true`, covering:
  - `"days"` kind — buffer count is exactly one less than the equivalent `false` case
  - `"behind"` kind — behind-count increases by exactly one
  - `"hidden"` and `"past"` kinds — unaffected by the flag (regression guard)
- Manual QA: onboarding required-choice validation (attempt to continue unanswered → blocked; answer Yes/No → proceeds and persists); Settings load/edit/save round-trip; buffer number on daily view updates immediately after a Settings toggle change.

## Out of Scope

- No retroactive backfill prompt or banner for existing families — Settings-only opt-in (Project Owner decision).
- No change to how the appointment day itself is excluded — that logic is untouched.
- No Capacitor/native-specific behavior — this is pure web/shared logic.
