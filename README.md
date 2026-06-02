# Tip Pal

A daily dosing assistant for families in food allergy tolerance induction programs.

**Live app:** [tippal.behrman.dev](https://tippal.behrman.dev) — currently in active dogfooding. Core features are working but the app is under active development and not yet feature complete. Use with that in mind.

---

## Status

Tip Pal is in active development. Phase 2 (core dosing, shared state, push notifications) is complete and in use. Several critical features are still in progress, including App Store distribution, new food cycle management, and emergency medication expiry tracking. The app works and is being used daily, but expect rough edges and missing features.

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
- **Complete Day gate** — requires all evening treatment foods checked before advancing
- **Skip session logging** — morning and evening skips recorded separately
- **Completion-based week advancement** — 7 complete days auto-advances the week
- **Appointment date and buffer days** — see how many days remain before your next visit
- **Trailing 3-day edit** — correct checkbox state for recent completed days
- **Full dose history** — chronological log of every session, useful at clinic appointments
- **Shared real-time state** — both parents see the same schedule and checkboxes
- **Push notifications** — configurable morning and evening dose reminders
- **"[Family Name]'s Tip Pal"** — personalized during onboarding

---

## What's Coming

- **App Store and Google Play** — native iOS and Android apps
- **New food cycle flow** — start a new cycle after a clinic visit without losing history
- **Emergency medication expiry tracker** — scenario kit and EpiPen expiration dates with advance warnings
- **Recommended foods view** — track 3 to 5x weekly frequency targets
- **Food grouping** — check off composite foods as a single item

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

## License

AGPL v3 — free to self-host, run, and adapt. Commercial use requires publishing all changes under the same license.

---

## About

Built by a TIP parent for TIP families.

Questions or feedback: open an issue or reach out at [dan@behrman.dev](mailto:dan@behrman.dev).x1