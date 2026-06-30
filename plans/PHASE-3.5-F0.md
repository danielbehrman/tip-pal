# Phase 3.5 F0 — Design System Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay CSS design tokens, UI primitive components, bottom navigation, and the /foods route rename that all Phase 3.5 screen redesigns build on.

**Architecture:** Color tokens added to `globals.css` via Tailwind 4's `@theme` (new token names only — no override of built-in Tailwind classes used by existing screens). Typography, spacing, and radius go into `:root` as plain CSS custom properties, consumed by new components via CSS variable syntax. Five UI primitive components created in `components/ui/`. `BottomNav` added to root layout. `/recommended` route moved to `/foods`. Zero changes to existing screen components beyond the one link update in `DailyView.tsx`.

**Tech Stack:** Next.js 15 App Router, Tailwind CSS v4 (`@import "tailwindcss"` / `@theme`), TypeScript strict, Supabase

## Global Constraints

- App name is "Tip Pal" — never "TIP Pal"
- No new npm dependencies
- TypeScript strict mode — no `any`, no suppressed errors
- No comments unless WHY is non-obvious
- All `fetch()` calls to `/api/*` must prefix with `process.env.NEXT_PUBLIC_API_BASE_URL ?? ''` (Capacitor requirement — existing code already does this, don't break it)
- No screen-level UI changes to existing pages — only `globals.css`, `layout.tsx` (global shell), and the route rename touch existing files
- Commit after each task

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `app/globals.css` | Modify | Add `@theme` color tokens + `:root` typography/spacing/radius tokens + app-container class |
| `app/layout.tsx` | Modify | Update themeColor, body background, add max-width container wrapper, add BottomNav |
| `app/recommended/page.tsx` | Delete | Route moved to /foods |
| `app/foods/page.tsx` | Create | Identical content to old recommended/page.tsx |
| `components/DailyView.tsx` | Modify | Update `/recommended` link to `/foods` (one line) |
| `components/BottomNav.tsx` | Create | 4-tab bottom nav — Today, History, Rec. Foods, Settings |
| `components/ui/CheckCircle.tsx` | Create | Morning (orange) and evening (purple) check circle variants |
| `components/ui/FoodCard.tsx` | Create | Standard card container — check, info, badge slots |
| `components/ui/SectionHeader.tsx` | Create | Morning/evening section label with icon and count |
| `components/ui/CTAButton.tsx` | Create | Primary, secondary, danger, disabled button variants |
| `components/ui/Badge.tsx` | Create | CAPPED badge and week badge (design-token versions) |

---

## Task 1: CSS Design Tokens + App Container

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

**Interfaces:**
- Produces: CSS custom properties `--color-primary`, `--color-evening`, etc. available globally
- Produces: Tailwind utilities `bg-primary`, `text-primary`, `bg-evening`, `text-evening`, `bg-ring-new`, `bg-ring-old`, `bg-med`, `bg-surface`, `text-text-primary`, `text-text-secondary`, `text-text-muted`, `text-text-section`, `bg-bg`, `bg-bg-secondary` — each maps directly to a `--color-*` token
- Produces: CSS class `.app-container` for max-width centering
- Produces: `:root` CSS variables for typography (`--text-xs` through `--text-4xl`), spacing (`--radius-sm` through `--radius-full`), and borders (`--border-thin`)

- [ ] **Step 1: Replace `app/globals.css` with the full token set**

The current file is 9 lines. Replace it entirely with:

```css
@import "tailwindcss";

@theme {
  /* Brand colors — mapped to bg-primary, text-primary, border-primary, etc. */
  --color-primary:        #ff6b35;
  --color-primary-light:  #fff0e6;
  --color-primary-pale:   #fff8f5;
  --color-primary-border: #ffb899;
  --color-primary-muted:  #f5e4dc;

  /* Evening / treatment */
  --color-evening:        #9b6fd4;
  --color-evening-light:  #f0eaff;
  --color-evening-pale:   #faf8ff;
  --color-evening-border: #c4a8f0;

  /* Progress ring */
  --color-ring-new:       #4fc3f7;
  --color-ring-old:       #ff9966;

  /* Medications */
  --color-med:            #9b6fd4;
  --color-med-light:      #f0eaff;
  --color-med-check:      #9b6fd4;

  /* Surface */
  --color-bg:             #fffbf7;
  --color-bg-secondary:   #f5efe9;
  --color-surface:        #ffffff;

  /* Text */
  --color-text-primary:   #2d1a0e;
  --color-text-secondary: #9a6a55;
  --color-text-muted:     #c4927a;
  --color-text-section:   #a07060;
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

  /* Font */
  --font-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
}

/* Typography scale — not in @theme to avoid overriding Tailwind's built-in text-* scale on existing screens */
:root {
  --text-xs-app:   10px;
  --text-sm-app:   11px;
  --text-base-app: 12px;
  --text-md-app:   13px;
  --text-lg-app:   14px;
  --text-xl-app:   15px;
  --text-2xl-app:  17px;
  --text-3xl-app:  20px;
  --text-4xl-app:  22px;

  --radius-sm:   4px;
  --radius-md:   10px;
  --radius-lg:   14px;
  --radius-xl:   16px;
  --radius-full: 9999px;

  --border-thin: 0.5px solid var(--color-border);
}

body {
  background: var(--color-bg);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}

/* Desktop: warm gutter fills the viewport outside the mobile column */
html {
  background: #f0ece8;
}

/* Mobile-first max-width container — applied in layout.tsx */
.app-container {
  max-width: 430px;
  margin: 0 auto;
  min-height: 100vh;
  background: var(--color-bg);
  position: relative;
}
```

**Note on naming:** Typography vars are named `--text-xs-app` (with `-app` suffix) rather than `--text-xs` to avoid colliding with Tailwind 4's built-in `--text-xs` token which maps to the `text-xs` utility. Existing screens use `text-xs`, `text-sm`, etc. from Tailwind's default scale and must not be affected. New F1+ components use `style={{ fontSize: 'var(--text-sm-app)' }}` or `className="text-[var(--text-sm-app)]"`.

- [ ] **Step 2: Update `app/layout.tsx` — themeColor, body class, app-container wrapper**

The current `app/layout.tsx` renders `<body className="bg-white text-gray-900">`. We need:
- `themeColor` updated from `#0f172a` to `#ff6b35`
- Remove `bg-white text-gray-900` from body (globals.css now handles this)
- Wrap `{children}` in a `<div className="app-container">`

Replace the file with:

```tsx
import type { Metadata, Viewport } from "next"
import "./globals.css"
import SignOutButton from "@/components/SignOutButton"
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister"

export const metadata: Metadata = {
  title: "TIP Pal",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.webp",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TIP Pal",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ff6b35",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        <div className="app-container">
          <SignOutButton />
          {children}
        </div>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles and build passes**

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm run build
```

Expected: build succeeds, no type errors or import errors. (Build may show Tailwind warnings about unknown utilities — these are safe to ignore as long as the build completes.)

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat(design): add Phase 3.5 CSS tokens and app-container wrapper"
```

---

## Task 2: Route Rename /recommended → /foods

**Files:**
- Create: `app/foods/page.tsx`
- Delete: `app/recommended/page.tsx` (and the `app/recommended/` directory)
- Modify: `components/DailyView.tsx` line 262 — one link href

**Interfaces:**
- Consumes: Nothing from Task 1
- Produces: `/foods` route serving the existing recommended foods page, `/recommended` returns 404

- [ ] **Step 1: Create `app/foods/page.tsx` with identical content to the old route**

The existing `app/recommended/page.tsx` contains the full recommended foods page. Copy it verbatim to `app/foods/page.tsx`. No content changes — just the new location.

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ParsedSchedule } from "@/lib/types"
import {
  fetchSchedule,
  fetchDoseState,
  saveRecommendedGiven,
  getSession,
} from "@/lib/supabase"
import RecommendedFoodsView from "@/components/RecommendedFoodsView"

export default function FoodsPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [currentWeek, setCurrentWeek] = useState(1)
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({})
  const [hydrated, setHydrated] = useState(false)
  const countsRef = useRef<Record<string, Record<string, number>>>({})

  useEffect(() => {
    async function load() {
      let session
      try {
        session = await getSession()
      } catch {
        router.replace("/login")
        return
      }
      if (!session) {
        router.replace("/login")
        return
      }

      try {
        const [s, ds] = await Promise.all([fetchSchedule(), fetchDoseState()])
        if (!s) {
          router.replace("/setup")
          return
        }
        const initialCounts = ds?.recommendedFoodCounts ?? {}
        setSchedule(s)
        setCurrentWeek(ds?.currentWeek ?? 1)
        setCounts(initialCounts)
        countsRef.current = initialCounts
        setHydrated(true)
      } catch {
        router.replace("/login")
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleGive(foodName: string) {
    setCounts(prev => {
      const weekKey = String(currentWeek)
      const weekCounts = prev[weekKey] ?? {}
      const updated = {
        ...prev,
        [weekKey]: { ...weekCounts, [foodName]: (weekCounts[foodName] ?? 0) + 1 },
      }
      countsRef.current = updated
      saveRecommendedGiven(updated).catch(() => {})
      return updated
    })
  }

  function handleUndo(foodName: string) {
    setCounts(prev => {
      const weekKey = String(currentWeek)
      const weekCounts = prev[weekKey] ?? {}
      const updated = {
        ...prev,
        [weekKey]: { ...weekCounts, [foodName]: Math.max(0, (weekCounts[foodName] ?? 0) - 1) },
      }
      countsRef.current = updated
      saveRecommendedGiven(updated).catch(() => {})
      return updated
    })
  }

  if (!hydrated || !schedule) return null

  const weekCounts = counts[String(currentWeek)] ?? {}

  return (
    <RecommendedFoodsView
      schedule={schedule}
      currentWeek={currentWeek}
      weekCounts={weekCounts}
      onGive={handleGive}
      onUndo={handleUndo}
    />
  )
}
```

- [ ] **Step 2: Delete the old `/recommended` route**

```bash
rm -rf app/recommended
```

- [ ] **Step 3: Update the link in `components/DailyView.tsx`**

Find line 262 in `components/DailyView.tsx`. It reads:
```tsx
<Link href="/recommended" className="text-sm text-gray-400 underline">
  Recommended
</Link>
```

Change it to:
```tsx
<Link href="/foods" className="text-sm text-gray-400 underline">
  Recommended
</Link>
```

(The label "Recommended" stays as-is — the bottom nav tab label "Rec. Foods" ships in Task 4.)

- [ ] **Step 4: Verify TypeScript compiles and build passes**

```bash
npx tsc --noEmit
```

Expected: no errors. (If you see "cannot find module 'app/recommended'" — verify the rm succeeded and the new app/foods/page.tsx exists.)

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/foods/page.tsx components/DailyView.tsx
git rm -r app/recommended
git commit -m "feat(nav): rename /recommended to /foods"
```

---

## Task 3: UI Primitive Components

**Files:**
- Create: `components/ui/CheckCircle.tsx`
- Create: `components/ui/FoodCard.tsx`
- Create: `components/ui/SectionHeader.tsx`
- Create: `components/ui/CTAButton.tsx`
- Create: `components/ui/Badge.tsx`

**Interfaces:**
- Consumes: CSS custom properties from Task 1 (`--color-primary`, `--color-evening`, `--color-primary-pale`, etc.)
- Produces (for F1+ screens to import):
  - `CheckCircle({ checked, session, size?, onClick? })` — `session: "morning" | "evening" | "med"`
  - `FoodCard({ children, checked, session })` — wrapper card with correct checked background/border
  - `SectionHeader({ session, label, count })` — `session: "morning" | "evening"`
  - `CTAButton({ children, variant?, disabled?, onClick?, type? })` — `variant: "primary" | "secondary" | "danger"`
  - `Badge({ variant })` — `variant: "capped" | "week"`

These components are **not wired into any existing screen** in this task. They are built so F1+ tasks can import them. The build must pass.

- [ ] **Step 1: Create `components/ui/CheckCircle.tsx`**

```tsx
interface CheckCircleProps {
  checked: boolean
  session: "morning" | "evening" | "med"
  size?: number
  onClick?: () => void
}

const SESSION_STYLES = {
  morning: {
    unchecked: "border-2 border-[#e8cfc4]",
    checked: "bg-[#ff6b35] border-[#ff6b35]",
  },
  evening: {
    unchecked: "border-2 border-[#d4bef0]",
    checked: "bg-[#9b6fd4] border-[#9b6fd4]",
  },
  med: {
    unchecked: "border-2 border-[#d4bef0]",
    checked: "bg-[#9b6fd4] border-[#9b6fd4]",
  },
}

export default function CheckCircle({ checked, session, size = 22, onClick }: CheckCircleProps) {
  const styles = SESSION_STYLES[session]
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ width: size, height: size }}
      className={`flex-shrink-0 rounded-full flex items-center justify-center transition-colors ${
        checked ? styles.checked : styles.unchecked
      }`}
      aria-pressed={checked}
    >
      {checked && (
        <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 12 10" fill="none">
          <path d="M1 5l3.5 3.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Create `components/ui/FoodCard.tsx`**

```tsx
interface FoodCardProps {
  children: React.ReactNode
  checked: boolean
  session: "morning" | "evening" | "med"
}

const SESSION_CHECKED_STYLES = {
  morning: "bg-[#fff8f5] border-[#ffb899]",
  evening: "bg-[#faf8ff] border-[#c4a8f0]",
  med: "bg-[#faf8ff] border-[#e8dff5]",
}

export default function FoodCard({ children, checked, session }: FoodCardProps) {
  return (
    <div
      className={`rounded-[14px] border px-3 py-[10px] mb-[7px] transition-colors ${
        checked
          ? SESSION_CHECKED_STYLES[session]
          : "bg-white border-[#f0ddd4]"
      }`}
      style={{ borderWidth: "0.5px" }}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Create `components/ui/SectionHeader.tsx`**

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
          style={{ background: isMorning ? "#fff0e6" : "#f0eaff" }}
        >
          {isMorning ? "☀️" : "🌙"}
        </span>
        <span
          className="text-xs font-medium uppercase tracking-[0.04em]"
          style={{ color: "#6b4c3b" }}
        >
          {label}
        </span>
      </div>
      <span className="text-xs" style={{ color: "#c4927a", fontSize: "11px" }}>
        {count}
      </span>
    </div>
  )
}
```

- [ ] **Step 4: Create `components/ui/CTAButton.tsx`**

```tsx
interface CTAButtonProps {
  children: React.ReactNode
  variant?: "primary" | "secondary" | "danger"
  disabled?: boolean
  onClick?: () => void
  type?: "button" | "submit"
}

const VARIANT_STYLES = {
  primary: "bg-[#ff6b35] text-white disabled:bg-[#f5e4dc] disabled:text-[#c4927a]",
  secondary: "bg-transparent text-[#c4927a] border border-[#f0ddd4]",
  danger: "bg-white text-[#e05252] border border-[#f5c4c4]",
}

export default function CTAButton({
  children,
  variant = "primary",
  disabled = false,
  onClick,
  type = "button",
}: CTAButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-[16px] py-[13px] text-[15px] font-medium transition-colors ${VARIANT_STYLES[variant]}`}
      style={{ borderWidth: variant === "primary" ? 0 : "0.5px" }}
    >
      {children}
    </button>
  )
}
```

- [ ] **Step 5: Create `components/ui/Badge.tsx`**

These are the design-system badge variants used on food cards. (The diff badges in `NewCycleReview.tsx` — NEW/CHANGED/UPDATED — are separate and stay inline there.)

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
        style={{ background: "#fff0e6", color: "#c45a1a" }}
      >
        CAPPED
      </span>
    )
  }
  return (
    <span
      className="text-[9px] font-medium px-1.5 py-0.5 rounded-[4px]"
      style={{ background: "#f0eaff", color: "#7a4db8" }}
    >
      {label ?? "Wk"}
    </span>
  )
}
```

- [ ] **Step 6: Verify TypeScript compiles and build passes**

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm run build
```

Expected: build succeeds. All 5 new files compile cleanly.

- [ ] **Step 7: Commit**

```bash
git add components/ui/
git commit -m "feat(design): add CheckCircle, FoodCard, SectionHeader, CTAButton, Badge primitives"
```

---

## Task 4: Bottom Nav + Layout Integration

**Files:**
- Create: `components/BottomNav.tsx`
- Modify: `app/layout.tsx`

**Interfaces:**
- Consumes: CSS tokens from Task 1 (colors via CSS vars), routes from Task 2 (`/foods`)
- Produces: `BottomNav` component — 4-tab bottom nav rendered in root layout on every page

**Design spec (from `plans/DESIGN-SPEC.md`):**
- 4 tabs: Today (`/daily`) · History (`/history`) · Rec. Foods (`/foods`) · Settings (`/settings`)
- Active: `color: #ff6b35`, `font-weight: 500`
- Inactive: `color: #e0c4b8`
- Labels: `font-size: 10px`
- Container: `border-top: 0.5px solid #f0ddd4`, `background: #fff`
- Height: fixed bottom, `padding: 8px 0 env(safe-area-inset-bottom)`
- The nav must NOT appear on: `/login`, `/setup`, `/onboarding`, and any page with no session (unauthenticated pages)

**Approach:** `BottomNav` is a client component (needs `usePathname`). It is imported into `app/layout.tsx` (server component — this is the standard Next.js pattern for adding client components to a server layout). The nav hides itself when the pathname matches an auth/onboarding route.

- [ ] **Step 1: Create `components/BottomNav.tsx`**

```tsx
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { label: "Today", href: "/daily", icon: "⊙" },
  { label: "History", href: "/history", icon: "◷" },
  { label: "Rec. Foods", href: "/foods", icon: "✦" },
  { label: "Settings", href: "/settings", icon: "⚙" },
] as const

const HIDDEN_ROUTES = new Set(["/login", "/setup", "/onboarding", "/"])

export default function BottomNav() {
  const pathname = usePathname()

  if (HIDDEN_ROUTES.has(pathname)) return null

  return (
    <nav
      className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full flex items-center"
      style={{
        maxWidth: 430,
        background: "#fff",
        borderTop: "0.5px solid #f0ddd4",
        paddingBottom: "env(safe-area-inset-bottom)",
        zIndex: 50,
      }}
    >
      {TABS.map(tab => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 flex flex-col items-center gap-0.5 py-2 no-underline"
            style={{
              color: active ? "#ff6b35" : "#e0c4b8",
              fontWeight: active ? 500 : 400,
              fontSize: 10,
            }}
          >
            <span style={{ fontSize: 18 }}>{tab.icon}</span>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

**Note on icons:** Simple Unicode symbols are used as placeholders. Phase 3.5 screen-level tasks (F1, F7) will replace these with proper SVG icons if Dan requests — the structure stays identical.

**Note on hiding:** `HIDDEN_ROUTES` hides the nav on the root redirect page (`/`), login, setup, and onboarding. Any new unauthenticated routes added later should be added to this set.

- [ ] **Step 2: Add BottomNav to `app/layout.tsx` and add bottom padding to content**

The content area needs bottom padding so food cards don't hide behind the fixed nav. Update `app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next"
import "./globals.css"
import SignOutButton from "@/components/SignOutButton"
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister"
import BottomNav from "@/components/BottomNav"

export const metadata: Metadata = {
  title: "TIP Pal",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.webp",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TIP Pal",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ff6b35",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        <div className="app-container">
          <SignOutButton />
          <div style={{ paddingBottom: 72 }}>
            {children}
          </div>
          <BottomNav />
        </div>
      </body>
    </html>
  )
}
```

The `paddingBottom: 72` (approx nav height + safe area) prevents content from being obscured by the fixed nav. This padding applies on all pages including those where the nav is hidden — it's safe because hidden nav pages (login, onboarding) control their own padding via their own full-screen layouts.

- [ ] **Step 3: Verify TypeScript compiles and build passes**

```bash
npx tsc --noEmit
```

Expected: no errors.

```bash
npm run build
```

Expected: build succeeds. 

- [ ] **Step 4: Start dev server and visually verify**

```bash
npm run dev
```

Open `http://localhost:3000/daily` (you'll be redirected to `/login` if not authenticated — that's fine). After logging in, verify:
1. Bottom nav appears with 4 tabs: Today · History · Rec. Foods · Settings
2. Active tab highlights in coral orange on the correct page
3. Nav does NOT appear on `/login`, `/setup`, `/onboarding`
4. `/recommended` returns 404; `/foods` loads the recommended foods page
5. CSS tokens are applied: body background is warm off-white (`#fffbf7`), not pure white

- [ ] **Step 5: Commit**

```bash
git add app/layout.tsx components/BottomNav.tsx
git commit -m "feat(nav): add BottomNav to root layout — 4-tab bottom navigation"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] CSS custom properties for all color tokens per `plans/DESIGN-SPEC.md` → Task 1
- [x] Typography scale → Task 1 (as `--text-*-app` CSS vars)
- [x] Spacing / shape tokens → Task 1 (`:root` block)
- [x] Bottom nav (Today · History · Rec. Foods · Settings), active/inactive state, correct routes → Task 4
- [x] Card, badge, check circle, section header, CTA button components match spec → Task 3
- [x] Morning (orange) and evening (purple) color coding applied throughout primitives → Task 3
- [x] No existing functionality broken → zero changes to existing screen components (except one link href in DailyView)
- [x] No screen-level UI changes → confirmed
- [x] Dan sign-off required before F1 → noted, not a code task
- [x] Max-width 430px container with warm gutter → Task 1 + Task 4
- [x] Route `/recommended` → `/foods` → Task 2

**Spec items NOT in this plan (by design):**
- Font-size `10px` labels on bottom nav → implemented inline in BottomNav (not via `@theme` to avoid Tailwind collision)
- SVG icons for bottom nav → placeholder Unicode characters; real icons are a screen-level concern for F1/F7

**Type consistency:**
- `session: "morning" | "evening" | "med"` used consistently in CheckCircle and FoodCard
- `variant: "capped" | "week"` in Badge
- `variant: "primary" | "secondary" | "danger"` in CTAButton
