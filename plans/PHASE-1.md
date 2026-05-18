# Phase 1 — Demo: Implementation Plan

**Architect Gate:** Passed  
**Date:** 2026-05-17  
**Features in scope:** F1-PARSE (Schedule Parsing), F2-DAILY (Daily Dose View)

---

## Stack

| Layer | Decision |
|---|---|
| Framework | Next.js 14+ — App Router, TypeScript |
| Styling | Tailwind CSS — mobile-first |
| API | `@anthropic-ai/sdk` in server-side API route only |
| Persistence | localStorage — two keys (see schema below) |
| Local dev | `vercel dev` — pulls ANTHROPIC_API_KEY from Vercel env vars |
| Model | `claude-sonnet-4-6` |

---

## File Structure

```
joshy-tip/
├── app/
│   ├── layout.tsx                    # Root layout — sets viewport, fonts, global styles
│   ├── page.tsx                      # Root: checks localStorage, redirects to /setup or /daily
│   ├── setup/
│   │   └── page.tsx                  # Setup flow: paste → loading → review → confirm → /daily
│   ├── daily/
│   │   └── page.tsx                  # Daily dose view — loads schedule + state from localStorage
│   └── api/
│       └── parse-schedule/
│           └── route.ts              # POST: calls Claude API, validates JSON, returns ParsedSchedule
├── components/
│   ├── PasteInput.tsx                # Multi-line textarea + submit button + error display
│   ├── ScheduleReview.tsx            # Review screen — lists all foods with inline edit capability
│   ├── FoodReviewRow.tsx             # Single editable row in review screen
│   ├── DailyView.tsx                 # Main daily view — week/day controls + sections
│   ├── MorningSection.tsx            # Morning foods list — maintenance + weekly (Day 7 only)
│   ├── EveningSection.tsx            # Evening foods list — treatment for current week + timing note
│   └── FoodItem.tsx                  # Single food row: name, dose, unit, prep note, CAPPED badge, checkbox
├── lib/
│   ├── types.ts                      # All TypeScript types
│   ├── storage.ts                    # localStorage read/write helpers
│   └── schedule.ts                   # Derivation helpers (get treatment foods for week, etc.)
├── .env.local.example               # ANTHROPIC_API_KEY=your_key_here (for reference)
└── .gitignore                       # Standard Next.js + .env.local
```

---

## TypeScript Types (`lib/types.ts`)

```typescript
export interface MaintenanceFood {
  name: string
  dose: number
  unit: string
  capped: boolean
  prepNote: string | null
}

export interface WeeklyFood {
  name: string
  dose: number
  unit: string
  prepNote: string | null
}

export interface TreatmentWeek {
  week: number
  dose: number
  unit: string
  isFinal: boolean
}

export interface TreatmentFood {
  name: string
  weeks: TreatmentWeek[]
}

export interface ParsedSchedule {
  maintenanceFoods: MaintenanceFood[]
  weeklyFoods: WeeklyFood[]
  treatmentFoods: TreatmentFood[]
}

export interface DoseState {
  currentWeek: number
  currentDay: number
  checkedFoods: Record<string, boolean>
}
```

---

## localStorage Schema

```
Key: "joshy-schedule"   → JSON.stringify(ParsedSchedule)
Key: "joshy-state"      → JSON.stringify(DoseState)
```

- `currentWeek` and `currentDay` default to 1 if state key is absent
- `checkedFoods` keys: `"morning-{index}"` for morning items, `"evening-{index}"` for evening items
- State is reset (checkedFoods cleared, day/week advanced) on Complete Day
- Schedule and state are independent — deleting schedule resets both

---

## API Route: `POST /api/parse-schedule`

**Request body:** `{ text: string }`  
**Response (success):** `{ schedule: ParsedSchedule }`  
**Response (error):** `{ error: string }`

**Implementation:**
1. Validate `text` is non-empty string
2. Instantiate `Anthropic` client (reads `ANTHROPIC_API_KEY` from env)
3. Call `client.messages.create` with system prompt + user message
4. Parse response content as JSON
5. Validate shape matches `ParsedSchedule` schema
6. Return `{ schedule }` or `{ error: "..." }`

**Model:** `claude-sonnet-4-6`  
**Max tokens:** 4096

---

## Claude System Prompt (exact, to be used verbatim in route.ts)

```
You are a medical dosing schedule parser. Parse the provided text and return ONLY valid JSON with no explanation, no markdown, no code fences.

Return an object matching this exact schema:

{
  "maintenanceFoods": [
    { "name": "string", "dose": number, "unit": "string", "capped": boolean, "prepNote": "string or null" }
  ],
  "weeklyFoods": [
    { "name": "string", "dose": number, "unit": "string", "prepNote": "string or null" }
  ],
  "treatmentFoods": [
    {
      "name": "string",
      "weeks": [
        { "week": number, "dose": number, "unit": "string", "isFinal": boolean }
      ]
    }
  ]
}

Parsing rules:
- maintenanceFoods: foods given every morning. Set capped=true if the notes indicate a maximum or capped dose.
- weeklyFoods: foods given once per week (Sunday or Day 7 only). These appear in the morning section once a week.
- treatmentFoods: foods with a weekly dose escalation schedule. Each entry has a weeks array covering each week's dose.
- Set isFinal=true on a TreatmentWeek if the notes say "continue at final dose", "maintain at", "continue", or similar terminal language for that dose level. Only the last week entry should have isFinal=true.
- Seeds (sesame seed, flax seed, etc.) must have prepNote set to "Crush before serving". This is a medical requirement.
- Any food with a specific preparation instruction must have that instruction in prepNote.
- If there is no prep note, set prepNote to null.
- dose must always be a number (not a string).
- All fields are required. Do not omit any field.
```

---

## Data Flow

### Feature 1 — Schedule Parsing

```
app/page.tsx
  → check localStorage["joshy-schedule"]
  → if missing → redirect /setup
  → if present → redirect /daily

app/setup/page.tsx  (client component, manages local state)
  State: { view: "paste" | "loading" | "review" | "error", rawText, parsedSchedule, error }

  View "paste":
    → render PasteInput
    → onSubmit: POST /api/parse-schedule with rawText
    → set view "loading"

  View "loading":
    → spinner / "Parsing schedule..."
    → await response
    → on success: set parsedSchedule, view "review"
    → on error: set error, view "error"

  View "review":
    → render ScheduleReview with parsedSchedule
    → allow inline edits (update parsedSchedule state)
    → onConfirm: save to localStorage["joshy-schedule"], init DoseState, redirect /daily

  View "error":
    → show error message
    → show retry button → back to view "paste" with rawText preserved
```

### Feature 2 — Daily Dose View

```
app/daily/page.tsx  (client component)
  → load ParsedSchedule from localStorage["joshy-schedule"]
  → load DoseState from localStorage["joshy-state"] (default: week:1, day:1, checkedFoods:{})
  → render DailyView

DailyView:
  → Week X / Day Y header with +/− controls (update DoseState on change)
  → MorningSection:
      - all maintenanceFoods
      - weeklyFoods shown only when DoseState.currentDay === 7
  → EveningSection:
      - treatmentFoods for currentWeek
      - if currentWeek > max week in schedule → show final week dose + "Continuing final dose" note
      - timing reminder: "4 hrs after morning · 15 min between foods · 1 hr rest after"
  → Complete Day button:
      - single confirmation tap
      - advances day: if day < 7 → day++; if day === 7 → day=1, week++
      - clears checkedFoods
      - saves DoseState to localStorage
```

---

## Edge Cases (Dev must handle all)

| Case | Expected behavior |
|---|---|
| No schedule in localStorage | Redirect to /setup on load |
| API returns non-JSON | `{ error: "Could not parse response" }`, retry available |
| API key missing | 500 from route, error message shown in UI |
| currentWeek > max defined week | Show final week dose + "Continuing final dose" note |
| Day 7 + Complete Day | Day resets to 1, week increments |
| Day not 7 | weeklyFoods hidden entirely |
| capped=true food | Display "CAPPED" badge — visually distinct (red or strong color) |
| prepNote present | Display inline beneath food name |
| isFinal=true week | Treated as the terminal dose entry; no further escalation expected |
| Re-parse schedule | Available from /daily — navigates back to /setup, clears schedule + state |

---

## UI Requirements

- **Mobile-first** — designed for phone use at 6am and 9pm
- **Large touch targets** — minimum 44px tap area on all interactive elements
- **High contrast** — legible in dark room / bleary eyes
- **Calm, clinical aesthetic** — no decorative elements, no animations, no clutter
- **CAPPED badge** — visually distinct, red or amber, cannot be missed
- **Prep notes** — displayed inline beneath food name, muted text style
- **Complete Day button** — prominent, full-width, bottom of screen

---

## Build Order for Dev

1. `npx create-next-app@latest joshy-tip --typescript --tailwind --app --src-dir no --import-alias "@/*"` in `/Users/dan/Shipyard/tippal`
2. Install `@anthropic-ai/sdk`
3. Write `lib/types.ts`
4. Write `lib/storage.ts`
5. Write `lib/schedule.ts`
6. Write `app/api/parse-schedule/route.ts`
7. Write `app/page.tsx` (redirect logic)
8. Write `components/PasteInput.tsx`
9. Write `components/FoodReviewRow.tsx`
10. Write `components/ScheduleReview.tsx`
11. Write `app/setup/page.tsx`
12. Write `components/FoodItem.tsx`
13. Write `components/MorningSection.tsx`
14. Write `components/EveningSection.tsx`
15. Write `components/DailyView.tsx`
16. Write `app/daily/page.tsx`
17. Write `app/layout.tsx`
18. Write `.env.local.example`
19. Smoke test: `vercel dev`

---

## Out of Scope (Phase 1)

- Auth, database, Supabase
- Date awareness, calendar logic
- Buffer calculation, appointment dates
- Skip session, trailing edits
- Push notifications
- Dose history

**Architect gate: PASS. Dev may proceed.**
