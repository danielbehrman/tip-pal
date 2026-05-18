# TIP Pal

A daily dosing assistant for food allergy tolerance induction therapy (TIP).

Built for a family managing a multi-year oral immunotherapy program for their young son. Open the app, see exactly what to give, check it off. That's it.

---

## The Problem

TIP programs involve giving precise doses of allergenic foods every day, split across morning and evening sessions, across many treatment weeks. The schedule is complex:

- **Morning:** maintenance foods (daily) + weekly foods (Sundays only)
- **Evening:** treatment foods that change week by week, spaced 15 minutes apart, followed by a 1-hour rest
- Some foods are **capped** — exact dose, no more, no less
- Seeds require a **crush/chop reminder** before serving — a medical requirement, not a preference

The schedule comes from clinic notes as unstructured text. There's no app for this. Parents are manually tracking it at 6am and 9pm, when cognitive load is high and mistakes have real consequences. Wrong dose or wrong week can set treatment back by weeks.

---

## What It Does

**Paste the schedule, see exactly what to give today.**

1. Paste raw clinic notes into the setup screen
2. Claude parses them into a structured dosing schedule
3. Review and confirm the parsed output — nothing is saved without explicit confirmation
4. Open the app each session, check off doses as you go

---

## How It Works

**Schedule parsing** — The setup screen sends pasted clinic notes to a server-side API route, which calls the Anthropic Claude API and returns a structured JSON schedule. The parsed output is shown as a review screen before anything is saved. Every field is editable inline. Parsing is never silent.

**Daily dose view** — The main screen shows a Week/Day counter and two sections: Morning and Evening. Morning lists all maintenance foods, plus weekly foods when it's Day 7. Evening lists the treatment foods for the current week. Each food shows name, dose, unit, prep notes, and a CAPPED label where applicable. Everything has a checkbox. "Complete Day" advances the counter and resets checkboxes.

**No date logic** — The app has no calendar awareness. The Week and Day counters are manually adjustable. The only scheduling logic is: Day 7 shows weekly foods, and the Week counter selects which treatment doses appear in the evening section.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js |
| Storage | localStorage |
| Hosting | Vercel |
| Schedule Parsing | Anthropic Claude API (server-side) |

> This is a demo that proves the core concept. Shared state between parents, auth, and production infrastructure are Phase 2.

---

## Roadmap

**Phase 1 — Demo** *(current)*
- Schedule parsing via Claude API
- Daily dose view with checkboxes and manual week/day controls

**Phase 2 — Production**
- Supabase for shared real-time state (both parents see the same data)
- Auth (two accounts)
- Appointment date entry and buffer day calculation
- Automatic week advancement on 7 completed doses
- Skip session support
- Trailing 3-day edit
- Push notification reminders