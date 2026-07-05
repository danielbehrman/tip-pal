# Phase 3.6 F1 — Color Scheme Migration + iOS Best Practice Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every hardcoded coral-orange-palette color literal in the codebase with the new navy/cyan/amber token references, and apply the four locked iOS hardening fixes — no layout, logic, or feature changes.

**Architecture:** Pure token/literal substitution. `app/globals.css`'s `@theme` block is rewritten with new values; every other file gets its hardcoded hex literals swapped for `var(--color-x)` references per the rules below. No component structure, props, or call-site wiring changes.

**Tech Stack:** Next.js App Router, Tailwind 4 `@theme` CSS custom properties, Capacitor (iOS).

**Source spec:** `docs/superpowers/specs/2026-07-04-phase-3.6-f1-color-ios-hardening-design.md` — read this first if anything below is ambiguous; this plan is its executable form.

## Global Constraints

These apply to every task below. Do not deviate without flagging back to Architect.

1. **Colors, safe-area fixes, viewport tag, and text scaling only.** No layout, component, logic, routing, or feature changes.
2. **Every replacement is `var(--color-x)` or `bg-[var(--color-x)]` / `text-[var(--color-x)]`** (Tailwind arbitrary-value syntax) — never a new literal hex, except the two documented exceptions in rule 25 and Task 2.
3. **Universal substitution rules** (apply these uniformly; each task below tells you which rules apply to which lines):
   - **R1:** `#ff6b35` as the background of a full-width `<header>` element (page-top chrome) → `var(--color-primary)`
   - **R2:** `#ff6b35` everywhere else (buttons, CTAs, badges, links, active states, pips, accents) → `var(--color-primary-mid)`
   - **R3:** `#fffbf7` (page/container background) → `var(--color-bg)`
   - **R4:** `#f5efe9` OR `#fff8f5` (both are old secondary-surface tints, collapsed into one new token) → `var(--color-bg-secondary)`
   - **R5:** `#f0ddd4` (generic border/divider) → `var(--color-primary-border)`
   - **R6:** `#2d1a0e` (primary text) → `var(--color-text-primary)`
   - **R7:** `#9a6a55` (secondary text) → `var(--color-text-secondary)`
   - **R8:** `#c4927a` (muted text) → `var(--color-text-muted)`
   - **R9:** `#fff3ec` (avatar/child-photo placeholder circle background, wherever it appears) → `var(--color-primary-light)`
   - **R10:** `#4fc3f7` (ring-new stroke) → `var(--color-ring-new)`
   - **R11:** `#ff9966` (ring-old / ghost arc) → **UNCHANGED** (Phase 3.5 F8 spec value, still correct)
   - **R12:** `#dc2626` (generic form-validation error red) → **UNCHANGED** (not coral-derived)
   - **R13:** `#22c55e` (generic success green) → **UNCHANGED**
   - **R14:** `#fff8e1` / `#ffe082` / `#795548` (warning banner) → **UNCHANGED** (identical value in old and new palette)
   - **R15:** `#e05252` / `#f5c4c4` (CTAButton danger variant) → **UNCHANGED**
   - **R16:** `#dbeafe`/`#1e40af`, `#dcfce7`/`#166534`, `#fee2e2`/`#991b1b` (new-cycle diff badges) → **UNCHANGED**
   - **R17:** `#e8f4fd`/`#bdddf5`/`#1a5276`/`#2980b9` (DailyView appointment-day info box) → **UNCHANGED**
   - **R18:** `#e6f4f1`/`#2a7a6b` (FoodItem "Weekly" badge, teal) → **UNCHANGED**
   - **R19:** `#4a3728` (DailyView info-sheet body text) → `var(--color-text-primary)` (semantic role: body text on a white card)
   - **R20:** `#6b4c3b` (SectionHeader label text) → `var(--color-text-section)`
   - **R21:** bare `#fff` / `white` / `rgba(255,255,255,*)` → **UNCHANGED** everywhere
   - **R22 (item-type-driven card colors):** In `FoodCard.tsx` / `CheckCircle.tsx`, the `session` prop is already wired item-type-correctly at the call site (see Task 3 — do not touch call sites). Old shared purple (`#9b6fd4`/`#c4a8f0`/`#f0eaff`/`#faf8ff`) splits: `evening` key → cyan `--color-treatment-*` family, `med` key → amber `--color-med-*` family.
   - **R23 (session-level summary, not item-level):** `DoseHistoryLog.tsx`'s AM/PM badges and skip-status dots are day-level summaries, not rendered food items — `am-skipped`/"AM" → `var(--color-primary-mid)` (R2), `pm-skipped`/"PM" → `var(--color-treatment-check)` (documented call: represents "the evening session" in aggregate).
   - **R24:** `rgba(45,26,14,0.4)` (dark overlay tinted with old `--color-text-primary`) → `rgba(13,31,92,0.4)` (new `--color-text-primary` #0d1f5c as RGB — `rgba()` can't reference a hex `var()`, so this is a literal by necessity, same class of exception as Task 2's `themeColor`)
   - **R25:** Recommended Foods pip dots: filled `#ff6b35` → `var(--color-primary-mid)`, empty `#f0ddd4` → `var(--color-primary-border)` (per Dan's explicit addendum to the spec)
4. **Verification per task:** after editing a file, run `grep -noE '#[0-9a-fA-F]{3,8}' <file>` and confirm only the R11–R18/R21 "unchanged" exceptions remain (plus any literal `#fff`/`white`).
5. **Commit after every task.**

---

### Task 1: `app/globals.css` — token layer rewrite

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Produces: every `--color-*` custom property consumed by all later tasks as `var(--color-x)`. Token names must match exactly what's used in Tasks 2–19 below.

- [ ] **Step 1: Confirm the old `@theme` block is what we expect**

Run: `head -62 app/globals.css`
Expected: the coral-orange `@theme` block from lines 1–61 as currently in the repo (starts `--color-primary: #ff6b35;`).

- [ ] **Step 2: Replace the `@theme` block (lines 1–61) with the new palette**

Replace lines 1–61 with:

```css
@import "tailwindcss";

@theme {
  /* Brand colors — navy/cyan/amber palette (Phase 3.6) */
  --color-primary:              #0a1f6e;
  --color-primary-mid:          #1a3a8a;
  --color-primary-light:        #dde8ff;
  --color-primary-pale:         #eef2ff;
  --color-primary-border:       #c5d0f0;
  --color-primary-checked:      #7a9ae8;
  --color-primary-muted:        #c5d0f0;
  --color-primary-text:         #5a78c4;

  --color-bg:                   #f0f4ff;
  --color-bg-secondary:         #e8eeff;
  --color-surface:              #ffffff;

  --color-text-primary:         #0d1f5c;
  --color-text-secondary:       #3b5ab8;
  --color-text-muted:           #5a78c4;
  --color-text-section:         #1a3a8a;
  --color-text-white:           #ffffff;

  --color-ring-new:             #01d4f1;
  --color-ring-track:           rgba(255,255,255,0.18);

  /* Treatment foods — cyan */
  --color-treatment-bg:              #e0f8fd;
  --color-treatment-bg-checked:      #b8f0fa;
  --color-treatment-border:          #00b8d9;
  --color-treatment-border-checked:  #007a94;
  --color-treatment-check:           #007a94;
  --color-treatment-text:            #007a94;
  --color-treatment-badge-bg:        #b8f0fa;
  --color-treatment-badge-text:      #007a94;
  --color-evening-icon-bg:           #d4f5fc;

  /* Medications + SLIT — amber */
  --color-med-bg:               #fff8e8;
  --color-med-bg-checked:        #fef0c0;
  --color-med-border:           #e8c240;
  --color-med-border-checked:   #c49a00;
  --color-med-check:            #c49a00;
  --color-med-text:             #8a6a00;

  /* Status — unchanged from old palette */
  --color-complete:       #4caf50;
  --color-partial:        #e09a3a;
  --color-danger:         #e05252;
  --color-warning-bg:     #fff8e1;
  --color-warning-border: #ffe082;
  --color-warning-text:   #795548;

  /* Font */
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;

  /* Override Tailwind text scale for mobile readability (Apple HIG targets) */
  --text-xs: 0.8125rem;   /* 13px */
  --text-sm: 0.9375rem;   /* 15px */
  --text-base: 1.0625rem; /* 17px */
  --text-lg: 1.1875rem;   /* 19px */
  --text-xl: 1.3125rem;   /* 21px */
  --text-2xl: 1.5rem;     /* 24px */
  --text-3xl: 1.875rem;   /* 30px */
}
```

- [ ] **Step 3: Add `-webkit-text-size-adjust` and split the html/body background (safe-area vs. desktop gutter)**

Find the existing block (originally lines 63–97, now shifted since Step 2 changed line count — locate by content, not line number):

```css
/* Typography scale — not in @theme to avoid overriding Tailwind's built-in text-* scale on existing screens */
:root {
  --text-xs-app:   10px;
  ...
  --border-thin: 0.5px solid var(--color-border);
}

body {
  margin: 0;
  padding: 0;
  background: #ff6b35;
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}

/* Orange fills any gap above the header (safe-area, desktop gutter) */
html {
  margin: 0;
  padding: 0;
  background: #ff6b35;
}
```

Replace the `body { ... }` and `html { ... }` rules (keep the `:root { ... }` typography block untouched above them) with:

```css
html {
  -webkit-text-size-adjust: 100%;
}

body, html {
  margin: 0;
  padding: 0;
  background: var(--color-primary); /* #0a1f6e — mobile default, matches header, fills iOS safe-area gap */
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}

@media (min-width: 431px) {
  body, html {
    background: var(--color-bg-secondary); /* #e8eeff — desktop gutter, once viewport exceeds the 430px app-container */
  }
}
```

Note: `color` and `font-family` were only on `body` before; keeping them on the merged `body, html` selector is harmless (html has no text content) and avoids a second near-duplicate rule.

- [ ] **Step 4: Verify no old hex remains except documented exceptions**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/globals.css`
Expected: only the new-palette values from Step 2, plus `#4caf50`, `#e09a3a`, `#e05252`, `#fff8e1`, `#ffe082`, `#795548` (R13/R14/R15 — unchanged status colors). No `#ff6b35`, `#fffbf7`, `#fff0e6`, `#9b6fd4`, or any other old-palette value.

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: build succeeds (Tailwind picks up new `@theme` tokens automatically — no other config changes needed).

- [ ] **Step 6: Commit**

```bash
git add app/globals.css
git commit -m "feat: migrate color tokens to navy/cyan/amber palette (Phase 3.6 F1)"
```

---

### Task 2: `app/layout.tsx` — themeColor literal

**Files:**
- Modify: `app/layout.tsx:24`

- [ ] **Step 1: Confirm current value**

Run: `grep -n themeColor app/layout.tsx`
Expected: `  themeColor: "#ff6b35",`

- [ ] **Step 2: Replace**

Change line 24 from:
```ts
  themeColor: "#ff6b35",
```
to:
```ts
  themeColor: "#0a1f6e",
```

This is a literal by necessity — Next's `Viewport` metadata field must be a plain string, not a CSS custom property.

- [ ] **Step 3: Verify**

Run: `grep -n themeColor app/layout.tsx`
Expected: `  themeColor: "#0a1f6e",`

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx
git commit -m "fix: update themeColor to new navy palette (Phase 3.6 F1)"
```

---

### Task 3: `components/ui/FoodCard.tsx` + `components/ui/CheckCircle.tsx` — item-type-driven card category colors

**Files:**
- Modify: `components/ui/FoodCard.tsx`
- Modify: `components/ui/CheckCircle.tsx`

**Interfaces:**
- Consumes: `session: "morning" | "evening" | "med"` prop, already computed correctly at call sites in `MorningSection.tsx` / `EveningSection.tsx` (medications always get `session="med"` regardless of AM/PM; only actual treatment-food rows get `session="evening"`).
- **Do not touch how `session` is computed or passed anywhere.** This task only changes the color values these two files look up from `session`.

- [ ] **Step 1: Confirm current FoodCard.tsx content matches expectations**

Run: `cat components/ui/FoodCard.tsx`
Expected: matches the version with `SESSION_CHECKED_STYLES`, `SESSION_DEFAULT_STYLES`, `SESSION_CHECKED_BORDER_COLOR`, `SESSION_DEFAULT_BORDER_COLOR` objects keyed by `morning`/`evening`/`med`, and a `partialStyle.borderColor: "#ff6b35"`.

- [ ] **Step 2: Rewrite FoodCard.tsx's color tables**

Replace lines 8–36 (the four `SESSION_*` objects plus the `partialStyle.borderColor` literal) so the file becomes:

```tsx
interface FoodCardProps {
  children: React.ReactNode
  checked: boolean
  session: "morning" | "evening" | "med"
  partial?: boolean
}

const SESSION_CHECKED_STYLES = {
  morning: "bg-[var(--color-primary-pale)]",
  evening: "bg-[var(--color-treatment-bg-checked)]",
  med: "bg-[var(--color-med-bg-checked)]",
}

const SESSION_DEFAULT_STYLES = {
  morning: "bg-white",
  evening: "bg-[var(--color-treatment-bg)]",
  med: "bg-[var(--color-med-bg)]",
}

const SESSION_CHECKED_BORDER_COLOR = {
  morning: "var(--color-primary-checked)",
  evening: "var(--color-treatment-border-checked)",
  med: "var(--color-med-border-checked)",
}

const SESSION_DEFAULT_BORDER_COLOR = {
  morning: "var(--color-primary-border)",
  evening: "var(--color-treatment-border)",
  med: "var(--color-med-border)",
}

export default function FoodCard({ children, checked, session, partial }: FoodCardProps) {
  const partialStyle: React.CSSProperties = {
    borderWidth: "1.5px",
    borderStyle: "dashed",
    borderColor: "var(--color-primary-mid)",
  }
  const checkedStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: SESSION_CHECKED_BORDER_COLOR[session],
  }
  const defaultStyle: React.CSSProperties = {
    borderWidth: "0.5px",
    borderStyle: "solid",
    borderColor: SESSION_DEFAULT_BORDER_COLOR[session],
  }

  const inlineStyle = partial ? partialStyle : checked ? checkedStyle : defaultStyle
  const bgClass = partial ? "bg-white" : checked ? SESSION_CHECKED_STYLES[session] : SESSION_DEFAULT_STYLES[session]

  return (
    <div
      className={`rounded-[14px] px-3 py-[10px] mb-[7px] transition-colors ${bgClass}`}
      style={inlineStyle}
    >
      {children}
    </div>
  )
}
```

(Note: `evening`/`med` default card backgrounds change from plain white/`#f5f0ff` to the category-tinted `--color-treatment-bg`/`--color-med-bg` — this is intentional per BRIEF's "Three card categories" spec, which requires the tint on the *default* state, not just checked, for colorblind-safe distinction. Partial-state dashed border stays a single accent color across all sessions — same behavior as before, just recolored — this is existing behavior, not a scope expansion.)

- [ ] **Step 3: Rewrite CheckCircle.tsx's color table**

Replace lines 10–26 (the `SESSION_STYLES` object) in `components/ui/CheckCircle.tsx` so it becomes:

```tsx
const SESSION_STYLES = {
  morning: {
    unchecked: { border: "2px solid var(--color-primary-border)" },
    checked: { background: "var(--color-primary-mid)", border: "2px solid var(--color-primary-mid)" },
    partial: { border: "2px dashed var(--color-primary-mid)", background: "transparent" },
  },
  evening: {
    unchecked: { border: "2px solid var(--color-treatment-border)" },
    checked: { background: "var(--color-treatment-check)", border: "2px solid var(--color-treatment-check)" },
    partial: { border: "2px dashed var(--color-treatment-check)", background: "transparent" },
  },
  med: {
    unchecked: { border: "2px solid var(--color-med-border)" },
    checked: { background: "var(--color-med-check)", border: "2px solid var(--color-med-check)" },
    partial: { border: "2px dashed var(--color-med-check)", background: "transparent" },
  },
}
```

Leave everything else in the file (the component body, the checkmark SVG with `stroke="white"`) untouched.

- [ ] **Step 4: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/ui/FoodCard.tsx components/ui/CheckCircle.tsx`
Expected: no output (both files now reference only `var(--color-x)`, and the checkmark's `stroke="white"` is a named color, not hex).

- [ ] **Step 5: Commit**

```bash
git add components/ui/FoodCard.tsx components/ui/CheckCircle.tsx
git commit -m "feat: recolor FoodCard/CheckCircle to navy/cyan/amber palette (Phase 3.6 F1)"
```

---

### Task 4: `components/ui/Badge.tsx` + `components/ui/SectionHeader.tsx` + `components/ui/CTAButton.tsx`

**Files:**
- Modify: `components/ui/Badge.tsx`
- Modify: `components/ui/SectionHeader.tsx`
- Modify: `components/ui/CTAButton.tsx`

- [ ] **Step 1: Rewrite Badge.tsx**

`Badge.tsx`'s `"capped"` variant is a maintenance-context label (any food's CAPPED marker) → primary family. Its `"week"` variant only ever renders on treatment-food items (`weekBadge` prop is only passed from `EveningSection.tsx`) → treatment/cyan family.

Replace the full file content:

```tsx
interface BadgeProps {
  variant: "capped" | "week"
  label?: string
}

export default function Badge({ variant, label }: BadgeProps) {
  if (variant === "capped") {
    return (
      <span
        className="text-[9px] font-semibold px-1.5 py-0.5 rounded-[4px]"
        style={{ background: "var(--color-primary-light)", color: "var(--color-primary-mid)" }}
      >
        CAPPED
      </span>
    )
  }
  return (
    <span
      className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px]"
      style={{ background: "var(--color-treatment-bg)", color: "var(--color-treatment-text)" }}
    >
      {label ?? "Wk"}
    </span>
  )
}
```

- [ ] **Step 2: Rewrite SectionHeader.tsx**

Replace the full file content:

```tsx
interface SectionHeaderProps {
  session: "morning" | "evening"
  label: string
  count: number
}

export default function SectionHeader({ session, label, count }: SectionHeaderProps) {
  const isMorning = session === "morning"
  return (
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <span
          className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-sm"
          style={{ background: isMorning ? "var(--color-primary-light)" : "var(--color-evening-icon-bg)" }}
        >
          {isMorning ? "☀️" : "🌙"}
        </span>
        <span
          className="font-medium uppercase tracking-[0.04em]"
          style={{ fontSize: 13, color: "var(--color-text-section)" }}
        >
          {label}
        </span>
      </div>
      <span className="text-xs" style={{ color: "var(--color-text-muted)", fontSize: "11px" }}>
        {count}
      </span>
    </div>
  )
}
```

- [ ] **Step 3: Rewrite CTAButton.tsx's primary and secondary variants (leave danger untouched — R15)**

In `components/ui/CTAButton.tsx`, replace lines 9–13:

```tsx
const VARIANT_STYLES = {
  primary: "bg-[#ff6b35] text-white disabled:bg-[#f5e4dc] disabled:text-[#c4927a]",
  secondary: "bg-transparent text-[#c4927a] border border-[#f0ddd4]",
  danger: "bg-white text-[#e05252] border border-[#f5c4c4]",
}
```
with:
```tsx
const VARIANT_STYLES = {
  primary: "bg-[var(--color-primary-mid)] text-white disabled:bg-[var(--color-primary-muted)] disabled:text-[var(--color-text-muted)]",
  secondary: "bg-transparent text-[var(--color-text-muted)] border border-[var(--color-primary-border)]",
  danger: "bg-white text-[#e05252] border border-[#f5c4c4]",
}
```

- [ ] **Step 4: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/ui/Badge.tsx components/ui/SectionHeader.tsx components/ui/CTAButton.tsx`
Expected: only `#e05252` and `#f5c4c4` remain (CTAButton's untouched danger variant, R15).

- [ ] **Step 5: Commit**

```bash
git add components/ui/Badge.tsx components/ui/SectionHeader.tsx components/ui/CTAButton.tsx
git commit -m "feat: recolor Badge/SectionHeader/CTAButton to new palette (Phase 3.6 F1)"
```

---

### Task 5: `components/BottomNav.tsx`

**Files:**
- Modify: `components/BottomNav.tsx:63,77`

Per product decision: background stays white — only the border and active/inactive tab colors change (R5, R2, R5-analog for inactive).

- [ ] **Step 1: Confirm current values**

Run: `grep -n '#f0ddd4\|#ff6b35\|#e0c4b8' components/BottomNav.tsx`
Expected:
```
63:        borderTop: "0.5px solid #f0ddd4",
77:              color: active ? "#ff6b35" : "#e0c4b8",
```

- [ ] **Step 2: Replace**

Line 63: `borderTop: "0.5px solid #f0ddd4",` → `borderTop: "0.5px solid var(--color-primary-border)",`
Line 77: `color: active ? "#ff6b35" : "#e0c4b8",` → `color: active ? "var(--color-primary-mid)" : "var(--color-primary-border)",`

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/BottomNav.tsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add components/BottomNav.tsx
git commit -m "feat: recolor BottomNav to new palette (Phase 3.6 F1)"
```

---

### Task 6: `components/DailyView.tsx`

**Files:**
- Modify: `components/DailyView.tsx`

Apply universal rules to these confirmed lines:

| Line | Old | Rule | New |
|---|---|---|---|
| 153 | `background: "#fffbf7"` | R3 | `background: "var(--color-bg)"` |
| 155 | `background: "#ff6b35"` (header) | R1 | `background: "var(--color-primary)"` |
| 173 | `stroke: "#4fc3f7"` | R10 | `stroke: "var(--color-ring-new)"` |
| 191 | `background: "#fff3ec"` (avatar fallback) | R9 | `background: "var(--color-primary-light)"` |
| 260 | `background: "#fff8f5"` (day-nav strip) | R4 | `background: "var(--color-bg-secondary)"` |
| 261 | `borderBottom: "0.5px solid #f0ddd4"` | R5 | `borderBottom: "0.5px solid var(--color-primary-border)"` |
| 273 | `border: "0.5px solid #f0ddd4"` | R5 | `border: "0.5px solid var(--color-primary-border)"` |
| 282 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 287 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 291 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 303 | `border: "0.5px solid #f0ddd4"` | R5 | `border: "0.5px solid var(--color-primary-border)"` |
| 312 | `stroke="#2d1a0e"` (SVG arrow) | R6 | `stroke="var(--color-text-primary)"` |
| 322 | `#fff8e1` / `#ffe082` | R14 | **unchanged** |
| 324 | `#795548` | R14 | **unchanged** |
| 333 | `#e8f4fd` / `#bdddf5` | R17 | **unchanged** |
| 336 | `#1a5276` | R17 | **unchanged** |
| 339 | `#2980b9` | R17 | **unchanged** |
| 346 | `background: "#ff6b35"` (Link CTA) | R2 | `background: "var(--color-primary-mid)"` |
| 390 | `color: "#4a3728"` | R19 | `color: "var(--color-text-primary)"` |
| 395 | `background: "#f5efe9"` | R4 | `background: "var(--color-bg-secondary)"` |
| 395 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |

Also note SVG arrows at lines 282/312 use `stroke="#2d1a0e"` (JSX attribute, not `style={{}}`) — same substitution, just written as `stroke="var(--color-text-primary)"` (SVG presentation attributes accept CSS custom properties as string values in JSX the same way).

Lines 233, 244, 272, 302, 387 (`#fff`) and the `rgba(255,255,255,...)` values throughout the header — unchanged (R21).

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/DailyView.tsx`
Expected: the full list of old hex values shown in the table above (plus `#fff` occurrences).

- [ ] **Step 2: Apply all replacements from the table above**

Use Edit (or targeted sed) for each line — several old values (`#2d1a0e`, `#9a6a55`, `#f0ddd4`) appear more than once with the *same* target everywhere in this file, so `replace_all: true` is safe for those. `#ff6b35` appears at both a header (line 155, → `var(--color-primary)`) and a CTA link (line 346, → `var(--color-primary-mid)`) — these need two separate non-`replace_all` edits since they map to different tokens.

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/DailyView.tsx`
Expected only: `#fff8e1`, `#ffe082`, `#795548` (R14), `#e8f4fd`, `#bdddf5`, `#1a5276`, `#2980b9` (R17), and bare `#fff`.

- [ ] **Step 4: Commit**

```bash
git add components/DailyView.tsx
git commit -m "feat: recolor DailyView to new palette (Phase 3.6 F1)"
```

---

### Task 7: `components/EveningSection.tsx`

**Files:**
- Modify: `components/EveningSection.tsx`

| Line | Old | Rule | New |
|---|---|---|---|
| 64 | `background: "#fff8e1", border: "0.5px solid #ffe082"` | R14 | **unchanged** |
| 66 | `color: "#795548"` | R14 | **unchanged** |
| 133 | `color: "#c4927a"` | R8 | `color: "var(--color-text-muted)"` |
| 142 | `background: "#f5efe9", border: "0.5px solid #f0ddd4"` | R4, R5 | `background: "var(--color-bg-secondary)", border: "0.5px solid var(--color-primary-border)"` |
| 144 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 150 | `background: "#ff6b35", color: "#fff"` (Skip confirm "Yes") | R2, R21 | `background: "var(--color-primary-mid)", color: "#fff"` |
| 157 | `background: "#f0ddd4", color: "#2d1a0e"` (Skip confirm "Cancel") | R5, R6 | `background: "var(--color-primary-border)", color: "var(--color-text-primary)"` |
| 168 | `color: "#c4927a"` | R8 | `color: "var(--color-text-muted)"` |

Note line 87 (`session="evening"`) and line 107 (`session="med"`) are prop values, not colors — do not touch (this is the item-type-driven wiring locked in Task 3/R22).

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/EveningSection.tsx`

- [ ] **Step 2: Apply replacements from the table**

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/EveningSection.tsx`
Expected only: `#fff8e1`, `#ffe082`, `#795548` (R14), and bare `#fff`.

- [ ] **Step 4: Commit**

```bash
git add components/EveningSection.tsx
git commit -m "feat: recolor EveningSection to new palette (Phase 3.6 F1)"
```

---

### Task 8: `components/FoodItem.tsx` + `components/FoodGroupRow.tsx`

**Files:**
- Modify: `components/FoodItem.tsx`
- Modify: `components/FoodGroupRow.tsx`

`FoodItem.tsx`:

| Line | Old | Rule | New |
|---|---|---|---|
| 51 | `checked ? "#c4927a" : "#2d1a0e"` | R8, R6 | `checked ? "var(--color-text-muted)" : "var(--color-text-primary)"` |
| 61 | `background: "#e6f4f1", color: "#2a7a6b"` (Weekly badge) | R18 | **unchanged** |
| 68 | `color: "#c4927a"` | R8 | `color: "var(--color-text-muted)"` |
| 73 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |

`FoodGroupRow.tsx` (always `session="morning"` — no treatment/med context here):

| Line | Old | Rule | New |
|---|---|---|---|
| 55 | `allChecked ? "#c4927a" : "#2d1a0e"` | R8, R6 | `allChecked ? "var(--color-text-muted)" : "var(--color-text-primary)"` |
| 63 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 73 | `color: "#c4927a"` | R8 | `color: "var(--color-text-muted)"` |
| 80 | `stroke="#c4927a"` | R8 | `stroke="var(--color-text-muted)"` |
| 100 | `borderBottom: "0.5px solid #f0ddd4"` | R5 | `borderBottom: "0.5px solid var(--color-primary-border)"` |
| 110 | `isChecked ? "#c4927a" : "#2d1a0e"` | R8, R6 | `isChecked ? "var(--color-text-muted)" : "var(--color-text-primary)"` |
| 113 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |

- [ ] **Step 1: Confirm baseline for both files**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/FoodItem.tsx components/FoodGroupRow.tsx`

- [ ] **Step 2: Apply replacements from both tables**

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/FoodItem.tsx components/FoodGroupRow.tsx`
Expected only: `#e6f4f1`, `#2a7a6b` (R18, FoodItem.tsx only).

- [ ] **Step 4: Commit**

```bash
git add components/FoodItem.tsx components/FoodGroupRow.tsx
git commit -m "feat: recolor FoodItem/FoodGroupRow to new palette (Phase 3.6 F1)"
```

---

### Task 9: `components/DoseHistoryLog.tsx`

**Files:**
- Modify: `components/DoseHistoryLog.tsx`

Per R23 — this file's colors are day-level summaries (AM/PM badges, status dots), not rendered food-card items, so they don't go through the FoodCard/CheckCircle session lookup. `am-skipped` maps like R2 (general primary accent); `pm-skipped` is a documented judgment call mapping to the treatment/cyan family since it represents "the evening session" in aggregate.

| Line | Old | Rule | New |
|---|---|---|---|
| 15 | `dotColor: "#22c55e"` (complete) | R13 | **unchanged** |
| 16 | `dotColor: "#ff6b35"` (am-skipped) | R23/R2 | `dotColor: "var(--color-primary-mid)"` |
| 17 | `dotColor: "#9b6fd4"` (pm-skipped) | R23 | `dotColor: "var(--color-treatment-check)"` |
| 18 | `dotColor: "#9a6a55"` (both-skipped) | R7 | `dotColor: "var(--color-text-secondary)"` |
| 80 | `borderBottom: "0.5px solid #f0ddd4"` | R5 | `borderBottom: "0.5px solid var(--color-primary-border)"` |
| 85 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 97 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 100 | `color: "#c4927a"` | R8 | `color: "var(--color-text-muted)"` |
| 109 | `background: "#fffbf7"` | R3 | `background: "var(--color-bg)"` |
| 114 | `background: "#ff6b35", color: "#fff"` (AM badge) | R23/R2, R21 | `background: "var(--color-primary-mid)", color: "#fff"` |
| 118 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 125 | `background: "#9b6fd4", color: "#fff"` (PM badge) | R23 | `background: "var(--color-treatment-check)", color: "#fff"` |
| 129 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 142 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 164 | `background: "#fff8f5"` | R4 | `background: "var(--color-bg-secondary)"` |
| 167 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/DoseHistoryLog.tsx`

- [ ] **Step 2: Apply replacements from the table**

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/DoseHistoryLog.tsx`
Expected only: `#22c55e` (R13), and bare `#fff`.

- [ ] **Step 4: Commit**

```bash
git add components/DoseHistoryLog.tsx
git commit -m "feat: recolor DoseHistoryLog to new palette (Phase 3.6 F1)"
```

---

### Task 10: `components/RecommendedFoodsView.tsx`

**Files:**
- Modify: `components/RecommendedFoodsView.tsx`

| Line | Old | Rule | New |
|---|---|---|---|
| 47 | `background: filled ? "#ff6b35" : "#f0ddd4"` (pip dots) | R25 | `background: filled ? "var(--color-primary-mid)" : "var(--color-primary-border)"` |
| 93 | `background: "#fffbf7"` | R3 | `background: "var(--color-bg)"` |
| 95 | `background: "#ff6b35"` (header) | R1 | `background: "var(--color-primary)"` |
| 124 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 134 | `border: "0.5px solid #f0ddd4"` | R5 | `border: "0.5px solid var(--color-primary-border)"` |
| 138 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 142 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 151 | `color: "#c4927a"` | R8 | `color: "var(--color-text-muted)"` |
| 164 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 174 | `borderBottom: "0.5px solid #f0ddd4"` | R5 | `borderBottom: "0.5px solid var(--color-primary-border)"` |
| 178 | `background: "#fff8f5"` (week-row header) | R4 | `background: "var(--color-bg-secondary)"` |
| 183 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |
| 190 | `background: "#ff6b35", color: "#fff"` ("Current" badge) | R2, R21 | `background: "var(--color-primary-mid)", color: "#fff"` |
| 197 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 200 | `color: "#c4927a"` | R8 | `color: "var(--color-text-muted)"` |
| 208 | `color: "#9a6a55"` | R7 | `color: "var(--color-text-secondary)"` |
| 221 | `color: "#2d1a0e"` | R6 | `color: "var(--color-text-primary)"` |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/RecommendedFoodsView.tsx`

- [ ] **Step 2: Apply replacements from the table**

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' components/RecommendedFoodsView.tsx`
Expected: no output (plus bare `#fff` occurrences on lines 107/110, untouched by R21).

- [ ] **Step 4: Commit**

```bash
git add components/RecommendedFoodsView.tsx
git commit -m "feat: recolor RecommendedFoodsView to new palette (Phase 3.6 F1)"
```

---

### Task 11: `app/login/page.tsx`

**Files:**
- Modify: `app/login/page.tsx`

| Line(s) | Old | Rule | New |
|---|---|---|---|
| 75 | `background: "#fffbf7"` | R3 | `var(--color-bg)` |
| 79 | `background: "#ff6b35"` (hero header) | R1 | `var(--color-primary)` |
| 110, 120, 166, 176, 220 | `border: "0.5px solid #f0ddd4"` | R5 | `var(--color-primary-border)` |
| 110, 120, 166, 176, 220 | `color: "#2d1a0e"` | R6 | `var(--color-text-primary)` |
| 123, 179, 223 | `color: "#dc2626"` | R12 | **unchanged** |
| 129, 185, 229 | `background: "#ff6b35"` (submit buttons) | R2 | `var(--color-primary-mid)` |
| 136, 192, 207, 238 | `color: "#9a6a55"` | R7 | `var(--color-text-secondary)` |
| 144 | `color: "#ff6b35"` ("Create account" link) | R2 | `var(--color-primary-mid)` |
| 155, 203 | `color: "#2d1a0e"` | R6 | `var(--color-text-primary)` |
| 249 | `color: "#c4927a"` | R8 | `var(--color-text-muted)` |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/login/page.tsx`

- [ ] **Step 2: Apply replacements from the table**

`#f0ddd4`, `#2d1a0e`, `#9a6a55` each map to the same new value at every occurrence in this file — safe to `replace_all`. `#ff6b35` needs one targeted edit for the hero (line 79 → `var(--color-primary)`) and `replace_all` for the remaining button/link occurrences (→ `var(--color-primary-mid)`) — do the targeted header edit first, then `replace_all` the rest.

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/login/page.tsx`
Expected only: `#dc2626` (R12), and bare `#fff`.

- [ ] **Step 4: Commit**

```bash
git add app/login/page.tsx
git commit -m "feat: recolor login page to new palette (Phase 3.6 F1)"
```

---

### Task 12: `app/setup/page.tsx`

**Files:**
- Modify: `app/setup/page.tsx`

| Line(s) | Old | Rule | New |
|---|---|---|---|
| 76 | `background: "#fffbf7"` | R3 | `var(--color-bg)` |
| 80 | `background: "#ff6b35"` (header) | R1 | `var(--color-primary)` |
| 85 | `stroke="#f0ddd4"` (ring track) | R5 | `stroke="var(--color-primary-border)"` |
| 89 | `background: "#fff3ec"` (avatar) | R9 | `var(--color-primary-light)` |
| 101, 109, 325 | `color: "#2d1a0e"` | R6 | `var(--color-text-primary)` |
| 108 | `border: "0.5px solid #f0ddd4"` | R5 | `var(--color-primary-border)` |
| 120, 139 | `color: "#9a6a55"` | R7 | `var(--color-text-secondary)` |
| 127, 169 | `background: "#ff6b35"` (buttons) | R2 | `var(--color-primary-mid)` |
| 133 | `color: "#c4927a"` | R8 | `var(--color-text-muted)` |
| 164 | `color: "#dc2626"` | R12 | **unchanged** |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/setup/page.tsx`

- [ ] **Step 2: Apply replacements from the table**

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/setup/page.tsx`
Expected only: `#dc2626` (R12), and bare `#fff`.

- [ ] **Step 4: Commit**

```bash
git add app/setup/page.tsx
git commit -m "feat: recolor setup page to new palette (Phase 3.6 F1)"
```

---

### Task 13: `app/onboarding/page.tsx`

**Files:**
- Modify: `app/onboarding/page.tsx`

| Line(s) | Old | Rule | New |
|---|---|---|---|
| 200 | `background: "#fffbf7"` | R3 | `var(--color-bg)` |
| 204 | `background: "#ff6b35"` (header) | R1 | `var(--color-primary)` |
| 243, 275 | `background: "#fff3ec"` (avatar) | R9 | `var(--color-primary-light)` |
| 286 | `background: "#ff6b35"` ("+" badge) | R2 | `var(--color-primary-mid)` |
| 295, 359, 380, 411, 440, 505, 516 | `color: "#9a6a55"` | R7 | `var(--color-text-secondary)` |
| 301, 324 (error branch), 330, 522 | `color: "#dc2626"` | R12 | **unchanged** |
| 314, 325, 353, 391, 395, 402, 422, 426, 431, 451, 455, 460, 506, 540, 554 | `color: "#2d1a0e"` | R6 | `var(--color-text-primary)` |
| 324 (default branch), 351, 385, 391, 402, 416, 422, 431, 445, 451, 460, 481, 503, 554 | `border/borderBottom: "0.5px solid #f0ddd4"` | R5 | `var(--color-primary-border)` |
| 338, 367, 469, 527, 546 | `background: "#ff6b35"` (Continue/Start buttons) | R2 | `var(--color-primary-mid)` |
| 362 | `color: "#c4927a"` | R8 | `var(--color-text-muted)` |
| 391, 402, 422, 431, 451, 460 | `background: "#f0ddd4"` (stepper +/- buttons) | R5 | `var(--color-primary-border)` |
| 517 | `color: "#22c55e"` | R13 | **unchanged** |
| 538 | `background: "rgba(45,26,14,0.4)"` (modal overlay) | R24 | `background: "rgba(13,31,92,0.4)"` |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}|rgba\(45,26,14' app/onboarding/page.tsx`

- [ ] **Step 2: Apply replacements from the table**

`#2d1a0e`, `#9a6a55`, `#dc2626` (unchanged) can be `replace_all`. `#f0ddd4` all map to the same new value here too (borders and stepper button backgrounds both → `var(--color-primary-border)`) — safe to `replace_all`. `#ff6b35` needs one targeted edit for the header (line 204 → `var(--color-primary)`) then `replace_all` for the rest (→ `var(--color-primary-mid)`).

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/onboarding/page.tsx`
Expected only: `#dc2626` (R12), `#22c55e` (R13), and bare `#fff`.

Run: `grep -n 'rgba(45,26,14' app/onboarding/page.tsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat: recolor onboarding page to new palette (Phase 3.6 F1)"
```

---

### Task 14: `app/settings/page.tsx`

**Files:**
- Modify: `app/settings/page.tsx`

| Line(s) | Old | Rule | New |
|---|---|---|---|
| 48 | `background: "#f0ddd4"` (RowDivider) | R5 | `var(--color-primary-border)` |
| 256 | `background: "#fffbf7"` | R3 | `var(--color-bg)` |
| 260 | `background: "#ff6b35"` (header) | R1 | `var(--color-primary)` |
| 268, 336, 351, 415, 454, 468, 479, 512, 532, 578 | `color: "#9a6a55"` | R7 | `var(--color-text-secondary)` |
| 273, 317 (default), 341, 363, 373, 388, 399, 459, 517, 537 | `border/borderBottom: "0.5px solid #f0ddd4"` | R5 | `var(--color-primary-border)` |
| 285 | `background: "#fff3ec"` (avatar) | R9 | `var(--color-primary-light)` |
| 295, 558, 584 | `background: "#ff6b35"` (edit badge, Save button, catchup "Yes") | R2 | `var(--color-primary-mid)` |
| 316 (default), 317 (default), 345, 357, 363, 367, 373, 382, 388, 392, 399, 408, 423, 439, 445, 540, 545, 575, 592 | `color: "#2d1a0e"` | R6 | `var(--color-text-primary)` |
| 316 (error), 317 (error), 322, 329, 489 (subscribed branch), 523, 552 | `color: "#dc2626"` | R12 | **unchanged** |
| 363, 373, 388, 399, 592 | `background: "#f0ddd4"` (stepper buttons / "No — skip") | R5 | `var(--color-primary-border)` |
| 425 | `color: "#22c55e"` | R13 | **unchanged** |
| 440, 446, 494, 498, 502, 541, 546, 566 | `color: "#c4927a"` | R8 | `var(--color-text-muted)` |
| 489 (unsubscribed branch) | `color: "#ff6b35"` (Enable push link) | R2 | `var(--color-primary-mid)` |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/settings/page.tsx`

- [ ] **Step 2: Apply replacements from the table**

`#f0ddd4`, `#2d1a0e`, `#9a6a55`, `#c4927a` all map uniformly to the same new value everywhere in this file — safe to `replace_all` each. `#ff6b35` needs one targeted edit for the header (line 260 → `var(--color-primary)`) then `replace_all` for the rest (→ `var(--color-primary-mid)`). Leave every `#dc2626` and the one `#22c55e` untouched.

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/settings/page.tsx`
Expected only: `#dc2626` (R12), `#22c55e` (R13), and bare `#fff`.

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: recolor settings page to new palette (Phase 3.6 F1)"
```

---

### Task 15: `app/history/page.tsx`

**Files:**
- Modify: `app/history/page.tsx:50,53`

| Line | Old | Rule | New |
|---|---|---|---|
| 50 | `background: "#fffbf7"` | R3 | `var(--color-bg)` |
| 53 | `background: "#ff6b35"` (header) | R1 | `var(--color-primary)` |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/history/page.tsx`
Expected: `50:#fffbf7` and `53:#ff6b35`.

- [ ] **Step 2: Apply replacements**

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/history/page.tsx`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add app/history/page.tsx
git commit -m "feat: recolor history page to new palette (Phase 3.6 F1)"
```

---

### Task 16: `app/new-cycle/page.tsx`

**Files:**
- Modify: `app/new-cycle/page.tsx`

| Line(s) | Old | Rule | New |
|---|---|---|---|
| 40 | `#dcfce7`/`#166534` (New badge) | R16 | **unchanged** |
| 42 | `#dbeafe`/`#1e40af` (Updated badge) | R16 | **unchanged** |
| 46 | `#fee2e2`/`#991b1b` (Removed badge) | R16 | **unchanged** |
| 47, 240, 277, 281, 315, 326, 350, 360, 443, 448, 470 | `color: "#9a6a55"`/`"#c4927a"` (mixed — see below) | R7/R8 | see below |
| 149 | `background: "#fffbf7"` | R3 | `var(--color-bg)` |
| 153 | `background: "#ff6b35"` (header) | R1 | `var(--color-primary)` |
| 185, 229, 276, 294, 302, 313, 329, 337, 353, 385, 453, 468 | `border/borderBottom: "0.5px solid #f0ddd4"` | R5 | `var(--color-primary-border)` |
| 187, 200, 219, 230, 283, 304, 339, 354, 431, 471 | `color: "#2d1a0e"` | R6 | `var(--color-text-primary)` |
| 199, 207, 246, 368, 479, 493 | `background`/`color: "#ff6b35"` (accents/buttons) | R2 | `var(--color-primary-mid)` |
| 222, 315 (removed food name) | `color: "#9a6a55"` | R7 | `var(--color-text-secondary)` |
| 282, 285 | `color: "#c4927a"` (arrow/detail) | R8 | `var(--color-text-muted)` |
| 385 | `stroke="#f0ddd4"` (ring track) | R5 | `stroke="var(--color-primary-border)"` |
| 391, 442 | `stroke`/`background: "#ff9966"` (ghost arc) | R11 | **unchanged** |
| 404, 447 | `stroke`/`background: "#4fc3f7"` (new-visit arc) | R10 | `var(--color-ring-new)` |
| 419 | `background: "#fff3ec"` (avatar) | R9 | `var(--color-primary-light)` |
| 490 | `color: "#dc2626"` | R12 | **unchanged** |

- [ ] **Step 1: Confirm baseline**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/new-cycle/page.tsx`

- [ ] **Step 2: Apply replacements**

Replace status-badge colors (R16 lines 40/42/46) — leave untouched. Replace `#f0ddd4` uniformly (`replace_all` → `var(--color-primary-border)`, appears both as border/borderBottom values and the ring-track stroke at line 385 — same target, safe). Replace `#2d1a0e` uniformly (`replace_all` → `var(--color-text-primary)`). Replace `#9a6a55` — appears at lines 50/222/240/277/281/315(kept-food)/326/350/360/443/448/470, all → `var(--color-text-secondary)` — `replace_all` safe. Replace `#c4927a` — lines 47/282/285, all → `var(--color-text-muted)` — `replace_all` safe. Replace `#ff9966` — **do not touch** (R11). Replace `#4fc3f7` — lines 404/447, both → `var(--color-ring-new)` — `replace_all` safe. Replace `#fff3ec` — line 419 → `var(--color-primary-light)`. Replace `#dc2626` — **do not touch** (R12). Replace `#ff6b35`: line 153 is the header (targeted edit → `var(--color-primary)`); lines 199/207/246/368/479/493 are buttons/accents (`replace_all` after the header edit → `var(--color-primary-mid)`).

- [ ] **Step 3: Verify**

Run: `grep -noE '#[0-9a-fA-F]{3,8}' app/new-cycle/page.tsx`
Expected only: `#dcfce7`, `#166534`, `#dbeafe`, `#1e40af`, `#fee2e2`, `#991b1b` (R16), `#ff9966` (R11), `#dc2626` (R12), and bare `#fff`.

- [ ] **Step 4: Commit**

```bash
git add app/new-cycle/page.tsx
git commit -m "feat: recolor new-cycle page to new palette (Phase 3.6 F1)"
```

---

### Task 17: Capacitor config verification (no edits expected)

**Files:**
- Verify only: `capacitor.config.ts`
- Verify only: `ios/App/App/capacitor.config.json`

- [ ] **Step 1: Confirm both configs already have `overlaysWebView: true`**

Run: `grep -A2 StatusBar capacitor.config.ts ios/App/App/capacitor.config.json`
Expected: both show `overlaysWebView: true` (or `"overlaysWebView": true`) — already in sync from prior work. **No edits needed to either file.**

- [ ] **Step 2: Confirm viewport meta is single-source**

Run: `grep -rn 'viewport' app/layout.tsx`
Expected: only the `Viewport` export (lines ~20–25) with `viewportFit: "cover"` already set. No `<meta name="viewport">` tag anywhere else in the project (Next generates it from this export).

Run: `grep -rln 'name="viewport"' app/ --include="*.tsx"`
Expected: no output (no manual viewport meta tags exist).

- [ ] **Step 3: Re-sync iOS after all CSS/config changes**

Run: `npm run build:native`

Expected: builds successfully (renames `app/api` → `app/_api`, runs `next build`, restores `app/api`, runs `npx cap sync ios`). This picks up the new static export with updated colors into the native shell — no manual `cap sync` needed beyond what this script already does.

- [ ] **Step 4: No commit needed** (verification only, no file changes) — unless `npm run build:native` modifies any generated files under `ios/`, in which case: `git status` to check, and only commit if there's an actual diff.

---

### Task 18: Full build + repo-wide old-hex sweep + visual smoke check

**Files:** none (verification task)

- [ ] **Step 1: Repo-wide grep for any remaining old-palette hex values**

Run:
```bash
grep -rn '#ff6b35\|#fffbf7\|#fff0e6\|#9b6fd4\|#ffb899\|#f5e4dc\|#f0eaff\|#faf8ff\|#c4a8f0\|#f5efe9\|#fff8f5\|#2d1a0e\|#9a6a55\|#c4927a\|#a07060\|#f0ddd4\|#e8dff5\|#f5f0ff\|#6b4c3b\|#4a3728' app/ components/ --include="*.tsx" --include="*.ts" --include="*.css"
```
Expected: no output. If anything appears, it was missed in Tasks 1–16 — go fix it in the corresponding task before proceeding.

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 3: Visual smoke check on the web build**

Run: `npm run dev` (or serve the `out/` directory), then in a browser visit `/login`, `/daily`, `/history`, `/foods`, `/settings`, `/new-cycle`.
Expected: navy headers, cyan treatment cards, amber medication cards, white maintenance cards, no coral-orange anywhere, bottom nav still white with navy active tab.

This is a UI-affecting change — per this project's CLAUDE.md, Dan sign-off is required regardless of automated checks passing. Flag the following for his explicit review before this feature is considered done (do not mark Phase 3.6 F1 complete without these):
- Card colors distinguishable with protanopia (maintenance/treatment/medication)
- Zero white gap at top of screen on iOS Simulator (iPhone 15 Pro)
- Bottom nav taps do not trigger the iOS home gesture
- Single viewport meta with `viewport-fit=cover` confirmed (already verified in Task 17, but Dan should confirm the built app behaves correctly)

- [ ] **Step 4: No commit for this task** — this is the final verification gate before handing off to Reviewer/QA per this project's agent pipeline (PM → Architect → Dev → Reviewer → QA → UI Checkpoint → Dan).

---

## Self-Review Notes (completed during plan authoring)

- **Spec coverage:** All 11 sections of the design spec map to a task above — Task 1 covers spec §2/§8 (already-compliant verification folded into Task 17), Task 2 covers §6, Task 3 covers §5 (the locked item-type invariant), Task 4 covers the small shared UI primitives referenced throughout §3, Tasks 6–16 cover the full §9 file punch list, Task 5 covers §7 (bottom nav), Task 10 covers §4 (pip dots), Task 17 covers §8, Task 18 covers §11 (definition of done).
- **Placeholder scan:** no TBD/TODO; every step has literal old/new values or full replacement code blocks.
- **New judgment calls surfaced while reading full file contents (not in the original spec, resolved here via semantic-role mapping, consistent with the spec's own methodology):** `#fff3ec` avatar-placeholder background (R9), `#4a3728` and `#6b4c3b` non-token-exact text colors (R19/R20), `#f5efe9`/`#fff8f5` old-token collapse (R4), `rgba(45,26,14,0.4)` overlay tint (R24), and DoseHistoryLog's session-level (not item-level) AM/PM colors (R23). These don't contradict the locked spec — they extend its mapping methodology to literals the spec's file-listing pass didn't individually enumerate.
