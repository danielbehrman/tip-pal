# Tip Pal — Design System & UI Spec
## Claude Code Handoff Document
**Status:** Approved by Dan · June 2026
**Scope:** All screens for Phase 3 redesign — mobile-first (iOS primary), light mode only

---

## Design Principles

- This is a **family app**, not a medical tool. Warm, not clinical.
- Used at 6am and 9pm by tired parents. Every screen must be immediately scannable.
- Mobile is the primary surface. Web is secondary.
- Light mode only.

---

## Color Tokens

```css
/* Brand */
--color-primary:        #ff6b35;   /* coral-orange — headers, CTAs, morning checks */
--color-primary-light:  #fff0e6;   /* tint — morning section icons, CAPPED badge bg */
--color-primary-pale:   #fff8f5;   /* checked card bg, morning */
--color-primary-border: #ffb899;   /* checked card border, morning */
--color-primary-muted:  #f5e4dc;   /* disabled CTA bg */

/* Evening / treatment */
--color-evening:        #9b6fd4;   /* purple — evening checks, evening section icon */
--color-evening-light:  #f0eaff;   /* evening section icon bg, week badge bg */
--color-evening-pale:   #faf8ff;   /* checked evening card bg */
--color-evening-border: #c4a8f0;   /* checked evening card border */

/* Progress ring */
--color-ring-new:       #4fc3f7;   /* sky blue — program progress arc */
--color-ring-old:       #ff9966;   /* ghost arc for previous visit on cycle screen */

/* Medications (on daily view) */
--color-med:            #9b6fd4;   /* same as evening purple */
--color-med-light:      #f0eaff;
--color-med-check:      #9b6fd4;

/* Surface */
--color-bg:             #fffbf7;   /* app background */
--color-bg-secondary:   #f5efe9;   /* screen background (Settings, History, etc.) */
--color-surface:        #ffffff;   /* cards */

/* Text */
--color-text-primary:   #2d1a0e;
--color-text-secondary: #9a6a55;
--color-text-muted:     #c4927a;
--color-text-section:   #a07060;   /* section label headers */
--color-text-white:     #ffffff;

/* Borders */
--color-border:         #f0ddd4;
--color-border-checked: #ffb899;

/* Status */
--color-complete:       #4caf50;
--color-partial:        #e09a3a;
--color-danger:         #e05252;
--color-warning-bg:     #fff8e1;
--color-warning-border: #ffe082;
--color-warning-text:   #795548;
```

---

## Typography

```css
--font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;

/* Scale */
--text-xs:   10px;
--text-sm:   11px;
--text-base: 12px;
--text-md:   13px;
--text-lg:   14px;
--text-xl:   15px;
--text-2xl:  17px;
--text-3xl:  20px;
--text-4xl:  22px;
```

---

## Spacing & Shape

```css
--radius-sm:   4px;
--radius-md:   10px;
--radius-lg:   14px;
--radius-xl:   16px;
--radius-full:  9999px;

--border-thin: 0.5px solid var(--color-border);
```

---

## Components

### Header (orange, on every primary screen)
- Background: `--color-primary`
- Contains: avatar ring + child name + visit/week/day title + appointment bubble + buffer days row

### Avatar Ring
- Outer SVG ring, `r=26` in a `58×58` viewBox
- Track: `rgba(255,255,255,0.22)`, `stroke-width: 5`
- Progress arc: `#4fc3f7`, `stroke-width: 5`, `stroke-linecap: round`
- Starts at `-90deg` (12 o'clock), fills clockwise
- Progress = `currentVisitIndex / 25 * circumference` where `circumference = 2π×26 ≈ 163.4`
- Avatar inner circle: `inset: 6px`, holds child photo (emoji placeholder)
- Child photo: tappable in Settings → opens device photo library

### Appointment Bubble
- `background: rgba(255,255,255,0.20)`, `border-radius: 9999px`
- `padding: 3px 10px`, `font-size: 11px`, `font-weight: 400`, `color: #fff`
- No emoji, no border
- Text: `"61 days to appointment"`

### Buffer Days Row
- Sits immediately below the header block (replaces week progress bar)
- Left: label `"Buffer days"` — `font-size: 13px`, `font-weight: 400`, `color: rgba(255,255,255,0.85)`
- Right of label: value — `font-size: 13px`, `font-weight: 700`, `color: #fff`
- Far right: ⓘ circle button — `18×18px`, `border: 1.5px solid rgba(255,255,255,0.5)`, `font-size: 10px`, italic serif `i`
- ⓘ tap: sheet slides up explaining buffer days
  - Body copy: *"Buffer days are the days between completing your final week of dosing and your next clinic appointment. Your program requires at least 7 days on the final week's dose before your visit. Buffer days show how much cushion you have — so you know you're on track. Note: The day of your appointment and the day before (for travel) are not counted as buffer days."*
- `padding: 2px 16px 8px`

### Day Navigator
- Sits between header and food list
- Background: `#fff8f5`, `border-bottom: 0.5px solid #f0ddd4`
- Left/right chevron buttons: `28×28px`, `border-radius: 50%`, `background: #fff`
- Right chevron disabled (opacity 0.3) when on current unlogged day
- Center: date label `13px/500` + "Today" sub `11px`

### Food Card (standard)
- `background: #fff`, `border-radius: 14px`, `border: 0.5px solid #f0ddd4`
- `padding: 10px 12px`, `margin-bottom: 7px`
- Row: `[check-circle] [food-info] [badge]`
- Checked state: `background: #fff8f5`, `border-color: #ffb899`

### Check Circle (morning)
- `22×22px`, `border-radius: 50%`
- Unchecked: `border: 2px solid #e8cfc4`
- Checked: `background: #ff6b35`, `border-color: #ff6b35`, white checkmark SVG

### Check Circle (evening treatment)
- Unchecked: `border: 2px solid #d4bef0`
- Checked: `background: #9b6fd4`, `border-color: #9b6fd4`

### Check Circle (medication — on daily view)
- Same purple as evening: `#9b6fd4`
- Medication cards have `border-color: #e8dff5` (same as evening cards)
- Visually distinguishable from food via card background tint `#faf8ff`

### CAPPED Badge
- `font-size: 9px`, `font-weight: 600`, `padding: 2px 6px`
- `border-radius: 4px`, `background: #fff0e6`, `color: #c45a1a`

### Week Badge (treatment foods — per food, hidden when in sync)
- `font-size: 9px`, `font-weight: 500`, `padding: 2px 6px`
- `border-radius: 4px`, `background: #f0eaff`, `color: #7a4db8`
- **Only shown when treatment foods are out of sync with each other**

### Section Header (Morning / Evening)
- Icon: `22×22px` circle — Morning: `background: #fff0e6` ☀️ · Evening: `background: #f0eaff` 🌙
- Label: `12px`, `font-weight: 500`, `color: #6b4c3b`, `text-transform: uppercase`, `letter-spacing: 0.04em`
- Count: `11px`, `color: #c4927a`, right-aligned

### Group Food Card
- Collapsed: single checkbox (checks all) + group name + member list subtitle + `›` chevron (right)
- Expanded (via chevron tap only): sub-items with individual `16×16px` check circles
- Partial state (some but not all checked): dashed `1.5px` orange border on card, dashed circle on parent
- Checkbox and chevron are independent — checking the checkbox completes all; tapping chevron expands/collapses only
- Auto-expand does NOT happen on checkbox tap

### CTA Button
- Full width, `border-radius: 16px`, `padding: 13px`
- Primary: `background: #ff6b35`, `color: #fff`, `font-size: 15px`, `font-weight: 500`
- Disabled: `background: #f5e4dc`, `color: #c4927a`
- Secondary: transparent, `color: #c4927a`, `border: 0.5px solid #f0ddd4`
- Danger: `background: #fff`, `color: #e05252`, `border: 0.5px solid #f5c4c4`

### Bottom Nav
- 4 tabs: Today · History · Rec. Foods · Settings
- Active: `color: #ff6b35`, `font-weight: 500`
- Inactive: `color: #e0c4b8`
- `font-size: 10px` labels
- `border-top: 0.5px solid #f0ddd4`, `background: #fff`

### Settings Row
- Icon: `32×32px`, `border-radius: 8px` — color-coded by category
- Label: `14px`, `color: #2d1a0e`
- Value/input: right-aligned, `13px`, `color: #2d1a0e`
- `border-bottom: 0.5px solid #f8ede7`

---

## Screen Inventory

| Screen | Route | Notes |
|---|---|---|
| Login | `/login` | Email/password, create account, medical disclaimer |
| First parse | `/parse` | Shown after first login, before onboarding |
| Onboarding | `/onboarding` | 4 steps: child setup → appointment → visit/week/day → summary |
| Daily view | `/` | Primary screen |
| History | `/history` | Dose log grouped by week, expandable days |
| Trailing edit | `/history/edit` | Edit button on History, last 3 days only |
| Recommended Foods | `/foods` | This Week + History tabs |
| Settings | `/settings` | Child, Program, Notifications, Account, Legal |
| New Food Cycle | `/settings/new-cycle` | 4-step flow from Settings |
| Privacy Policy | `/privacy` | Static page |
| Medical Disclaimer | `/disclaimer` | Static page |

---

## Daily View — Medication Placement

Medications (e.g. Zyrtec, Flovent) appear **inline in the morning and/or evening food list** based on when they are given:
- Zyrtec: Morning
- Flovent (2× daily): Morning AND Evening

Medication cards use **purple** visual treatment (same as evening treatment foods):
- Card border: `#e8dff5`
- Check circle: `background: #9b6fd4` when checked
- No CAPPED badge, no week badge
- Dose shown in subtitle line as normal

---

## Treatment Food Week Tracking

**Data model — per-food week/day counters (replaces single global counter):**
- Each treatment food stores its own `week` and `day` in Supabase
- Global week/day displayed in header = the furthest-behind treatment food
- Buffer days calculated against the global (slowest) counter
- Per-food week badges hidden when all foods are in sync; shown when any food diverges
- Complete Day: each checked evening treatment food advances its own counter independently
- A food skipped individually stays on its current day; others advance
- A full evening skip blocks Complete Day (existing behaviour unchanged)

---

## Onboarding Flow (4 steps)

1. **Child setup** — child name input + optional photo upload. Header says "Welcome to Tip Pal" with no child name reference yet.
2. **Appointment date** — date picker, single field.
3. **Visit / Week / Day** — three steppers. Visit cycles through full sequence: Launch → Visit 1–20 → Tolerance 1 → Tolerance 2 → Remission 1 → Annual Remission. Header sub says "Set the week and day you're currently dosing on." No appointment reference.
4. **Summary** — mini header preview (no visit number until after parse), confirmation card, "Start dosing" → daily view.

---

## New Food Cycle Flow (4 steps)

1. **Confirm** — what-happens list before anything changes.
2. **Paste dosing plan** — text area, PII strip note. CTA: "Parse new dosing plan". Parsing state hidden until CTA tapped.
3. **Review changes** — visit transition card, treatment food diff (New / Updated / Removed), maintenance food diff (New / Kept). **Appointment date input lives here**, pre-filled from parsed notes, tappable to adjust.
4. **Cycle started** — large avatar with animated two-layer progress ring: orange ghost at old visit position, sky blue arc animates from zero to new position. Buffer days shown immediately. Summary card. CTA: "Start dosing".

---

## Visit Sequence (25 total)

```
Launch, Visit 1–20, Tolerance 1, Tolerance 2, Remission 1, Annual Remission
```

Progress ring = `currentVisitIndex / 25`

---

## Carry Forward to BRIEF.md

The following items emerged during design and must be added to BRIEF.md before the next Claude Code session:

1. **Child name replaces family name** — header displays child's name (e.g. "Joshy's Tip Pal"), not family name. Stored as `child_name` on the families/children table. Supports multi-child future.
2. **Child photo** — stored in Supabase Storage, displayed in header avatar. Tappable in Settings.
3. **Per-food week/day counters** — data model change. Each treatment food has independent `week` and `day` in Supabase. Global header counter = slowest food. Existing Phase 2 F4 week advancement logic must be refactored.
4. **Medications on daily view** — Zyrtec + Flovent move from a separate screen into the AM/PM food list with purple card treatment. Schema v2 `medications` array drives this.
5. **Bottom nav** — replaces current link-based navigation. 4 tabs: Today, History, Rec. Foods, Settings.
6. **Recommended Foods screen renamed** — nav label "Rec. Foods", route `/foods`, two tabs: This Week / History.
7. **Week badge visibility rule** — per-food week badges on evening cards hidden when all treatment foods are in sync; shown only when at least one diverges.
8. **Buffer days row** — replaces week progress bar in header. Calculated server-side, always current.
9. **New Food Cycle: appointment date input on review screen** — not a separate step.
10. **New Food Cycle: done screen** — animated ring (old position ghost + new position arc), no confetti. Buffer days pre-calculated.

---

## Web Layout

The web app shares the same codebase as native. No separate build needed.

**Max-width container — apply in F0:**
```css
body {
  background: #f0ece8; /* warm off-white fills desktop gutters */
}

.app-container {
  max-width: 430px;
  margin: 0 auto;
  min-height: 100vh;
  background: var(--color-bg); /* #fffbf7 */
  position: relative;
}
```

On mobile (native + browser) this fills the full viewport. On desktop it renders as a centered mobile column. No responsive breakpoints needed for Phase 3.5.
