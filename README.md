# Tip Pal

A daily dosing assistant for families in food allergy tolerance induction programs.

**Live app:** [tippal.behrman.dev](https://tippal.behrman.dev) — in active daily use. The core dosing, tracking, and history features are complete and stable. Native iOS app is in TestFlight beta ahead of App Store submission.

---

## Status

Tip Pal's core feature set is complete and in daily use by real families managing an active treatment program. Dosing, tracking, per-food progress, history/editing, reaction handling, and new-cycle management are all built and stable. The native iOS app is currently in TestFlight beta; App Store submission is the near-term focus. Android/Google Play is a future possibility, not yet scheduled.

If you self-host or use the live app, feedback is welcome.

---

## What It Does

Food allergy tolerance induction is a multi-year program where families give their child precisely measured doses of allergenic foods twice a day, every day, on a schedule that changes after every clinic visit.

The schedule is complex. On any given day you might be measuring 5 to 7 foods in small exact amounts, tracking which week of treatment you're on, and remembering which foods are capped (exact dose, no more, no less). You do this at 6am before school and again in the evening after a 4-hour gap. You do it tired.

Most families manage this off a printed chart from the clinic. Tip Pal replaces the chart.

**Paste your clinic notes. The app figures out the rest.**

An AI reads your plan of care and builds a structured schedule: morning maintenance foods, evening treatment foods, weekly foods, doses, units, prep notes. You get a clean checklist for each session. Check off each food as you give it. Tap Complete Day when you're done. The week counter advances automatically after 7 days.

---

## Features

- **AI-powered schedule parsing** — paste your plan of care notes directly from the clinic. No manual data entry.
- **Morning and evening dose views** — separated clearly, with prep notes inline
- **CAPPED food labels** — exact doses flagged visually throughout
- **Live auto-save** — check off a food and it's saved immediately, no "Complete Day" button required. Position and progress recompute automatically overnight from your actual dosing history, so nothing is lost if you close the app mid-session or two people are checking things off from different devices at once.
- **Independent per-food tracking** — each treatment food advances on its own schedule based on what's actually been checked; the week/day shown is always your furthest-behind food
- **Food grouping** — check off composite foods (like a mixed-seed jam) as a single item, with the option to expand and adjust individual components on days that differ
- **Recommended foods tracking** — 3–5x/week targets tracked separately, credited automatically when a matching food is checked anywhere else in the app
- **Reaction Ramp** — if a reaction happens mid-cycle, enter your clinic's ramp-back plan and the app freezes your position, overrides doses to match the ramp, and resumes automatically once it's complete
- **New food cycle flow** — start a new cycle after a clinic visit with a guided review of what's changing, without losing dosing history
- **Travel Day Buffer** — families who fly to appointments get an extra travel day automatically factored into their buffer-day calculation
- **History calendar with full-cycle editing** — browse any day in your current cycle, edit checkboxes for any day, and see your position and buffer recompute accurately from the correction
- **Appointment date and buffer days** — see how many days of cushion remain before your next visit
- **Full dose history** — chronological log of every session, useful at clinic appointments
- **Shared state** — both parents see the same schedule and checkboxes
- **Push notifications** — configurable morning and evening dose reminders (web push; native push notifications coming post-launch)
- **"[Child's Name]'s Tip Pal"** — personalized during onboarding

---

## What's Coming

- **App Store (near-term)** — iOS app is in TestFlight beta now, moving toward public App Store submission
- **Native push notifications** — reminders delivered through the native app instead of web push, first release after App Store launch
- **Emergency medication expiry tracker** — scenario kit and EpiPen expiration dates with advance warnings
- **Google Play / Android** — under consideration, not yet scheduled
- **Digital Food Passport** — a visual, stamp-style record of every food cleared at a challenge visit
- **Household invite flow** — join a family's account without manual setup

---

## Stack

- **Frontend:** Next.js
- **Database:** Supabase (Postgres + Auth)
- **Hosting:** Vercel
- **Schedule parsing:** Anthropic Claude API (server-side)
- **Push notifications:** Web Push via external cron

---

## Self-Hosting

Tip Pal is open source. If you're comfortable with Next.js and Supabase, you can run your own instance.

### Prerequisites

- Node.js 18+
- A Supabase project
- An Anthropic API key
- A Vercel account (or any Next.js host)

### Setup

1. Clone the repo

```bash
git clone https://github.com/[your-username]/tip-pal.git
cd tip-pal
npm install
```

2. Create a `.env.local` file:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ANTHROPIC_API_KEY=your_anthropic_api_key
NEXT_PUBLIC_VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_SUBJECT=mailto:you@example.com
CRON_SECRET=your_cron_secret
```

3. Run Supabase migrations (see `/supabase/migrations`)

4. Start the dev server:

```bash
npm run dev
```

5. For push notifications, set up an external cron to hit `/api/send-reminders` every minute with `Authorization: Bearer <your CRON_SECRET>`.

---

## Disclaimer

Tip Pal is not a medical device. It is not affiliated with the Food Allergy Institute or the Tolerance Induction Program. Always follow your provider's instructions. Never use this app as a substitute for the plan of care given to you by your clinical team.

---

## About

Built by a TIP parent for TIP families.

Questions or feedback: open an issue or reach out at [dan@behrman.dev](mailto:dan@behrman.dev).

---

## License

AGPL v3. Free to use and self-host. If you modify and distribute this code — including running it as a hosted service — you must publish your changes and credit the original project.