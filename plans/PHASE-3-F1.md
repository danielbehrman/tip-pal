# Phase 3 — F1: Capacitor Wrapper
## Implementation Plan (Option B locked — push hidden in native)

---

## PM Ticket

**Goal:** Wrap the Next.js app in a native iOS/Android shell via Capacitor static export. All Phase 1/2 functionality works identically in native. Push notification UI hidden in native (web push unaffected). App icon and splash screen configured.

**Acceptance criteria:**
- `npm run build:native` completes without errors
- `npx cap sync` copies the built app into both iOS and Android projects
- App launches on iOS simulator — login, parse, daily view, history, settings all work
- App launches on Android emulator — same verification
- Push notification subscribe/unsubscribe UI is not visible when running as native
- App icon and splash screen are configured (placeholder assets acceptable for Dev pass; Dan provides final assets before F7)
- No external payment or donation links anywhere in the app

**Constraints:**
- No Firebase, no FCM — push is Option B (hidden, not broken)
- Web build (`npm run build`) is unchanged — Vercel web deploy must continue working
- `IS_NATIVE=true` env var activates static export — never set on Vercel

---

## Architecture Notes

**Why conditional export:** `output: 'export'` disables server features (API routes, server components). The web app needs those. Setting `IS_NATIVE=true` only at native build time keeps the two build paths independent from the same codebase.

**API URL:** The static bundle loads from `file://` (iOS) or `https://localhost` (Android) inside the WebView. Relative paths like `/api/parse-schedule` resolve against that origin, not Vercel. The native build must use the full production URL.

**CORS:** The `/api/parse-schedule` route on Vercel will receive requests with `Origin: capacitor://localhost` (iOS) or `Origin: https://localhost` (Android). Next.js API routes don't restrict cross-origin by default, but we should explicitly allow these origins so future changes don't accidentally break native.

**Service worker:** `navigator.serviceWorker.register` fails silently in Capacitor's WKWebView and can produce console noise. Guard it.

**Push UI:** Hide the entire notifications section in Settings when running native. The feature still works for web PWA users.

---

## Dependencies to Install

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/splash-screen @capacitor/status-bar
npm install -D @capacitor/assets
```

---

## Files Changed

### 1. `next.config.ts`

```ts
import type { NextConfig } from "next"

const isNative = process.env.IS_NATIVE === "true"

const nextConfig: NextConfig = {
  ...(isNative && {
    output: "export",
    trailingSlash: true,
    images: { unoptimized: true },
  }),
}

export default nextConfig
```

`trailingSlash: true` is required for static export — without it, navigating directly to `/daily` returns a 404 from the file system. `images: { unoptimized: true }` disables the image optimization server that doesn't exist in static export.

---

### 2. `package.json` — add scripts

```json
"build:native": "IS_NATIVE=true NEXT_PUBLIC_API_BASE_URL=https://tippal.behrman.dev next build",
"cap:sync": "npm run build:native && npx cap sync",
"cap:open:ios": "npx cap open ios",
"cap:open:android": "npx cap open android"
```

`NEXT_PUBLIC_API_BASE_URL` is baked into the native bundle at build time. Vercel never sets this var — web builds use relative URLs.

---

### 3. `capacitor.config.ts` (new file)

```ts
import { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "dev.behrman.tippal",
  appName: "TIP Pal",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
}

export default config
```

`androidScheme: "https"` makes Android use `https://localhost` instead of `http://localhost`. Keeps the scheme consistent and avoids mixed-content issues.

---

### 4. `lib/platform.ts` (new file)

```ts
export function isNative(): boolean {
  if (typeof window === "undefined") return false
  return !!(window as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.()
}
```

Single source of truth for native detection. Used by ServiceWorkerRegister and Settings.

---

### 5. `app/setup/page.tsx` — prefix API URL

Change the fetch call in `handleSubmit`:

```ts
// Before:
const res = await fetch("/api/parse-schedule", { ... })

// After:
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? ""
const res = await fetch(`${apiBase}/api/parse-schedule`, { ... })
```

This is the only API route call in the client. All Supabase calls use the Supabase JS client (which uses its own absolute URL) and are unaffected.

---

### 6. `app/api/parse-schedule/route.ts` — add CORS headers

Add a CORS utility at the top of the file and include the headers on every response:

```ts
const CAPACITOR_ORIGINS = new Set(["capacitor://localhost", "https://localhost"])

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? ""
  if (CAPACITOR_ORIGINS.has(origin)) {
    return { "Access-Control-Allow-Origin": origin }
  }
  return {}
}
```

Apply to all return statements:
```ts
return NextResponse.json({ schedule }, { headers: corsHeaders(req) })
return NextResponse.json({ error: "..." }, { status: 400, headers: corsHeaders(req) })
```

Also add an OPTIONS handler for preflight:
```ts
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin") ?? ""
  if (CAPACITOR_ORIGINS.has(origin)) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    })
  }
  return new NextResponse(null, { status: 204 })
}
```

---

### 7. `components/ServiceWorkerRegister.tsx` — guard in native

```ts
"use client"

import { useEffect } from "react"
import { isNative } from "@/lib/platform"

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && !isNative()) {
      navigator.serviceWorker.register("/sw.js").catch(() => {})
    }
  }, [])
  return null
}
```

---

### 8. `app/settings/page.tsx` — hide push section in native

Import `isNative` and wrap the entire Reminders section:

```tsx
import { isNative } from "@/lib/platform"

// In render, replace the reminders section wrapper:
{!isNative() && (
  <div className="border-t border-gray-100 pt-5">
    {/* ... entire reminders section unchanged ... */}
  </div>
)}
```

The section contains morning/evening reminder times, timezone display, and the subscribe/unsubscribe button. All hidden in native. Family name, appointment date, week/day position, and Save button remain.

---

## Manual Steps (Dev must run in order)

These cannot be scripted — they generate the native project directories.

```bash
# 1. Initialize Capacitor (reads capacitor.config.ts)
npx cap init

# 2. Add platforms
npx cap add ios
npx cap add android

# 3. First build + sync to verify
npm run cap:sync

# 4. Generate app icon and splash screen assets
# Requires: assets/icon.png (1024×1024 PNG, no alpha) and assets/splash.png (2732×2732 PNG)
# Use a placeholder for Dev pass. Dan provides final assets before F7.
npx capacitor-assets generate

# 5. Open in Xcode to verify launch on simulator
npx cap open ios

# 6. Open in Android Studio to verify launch on emulator
npx cap open android
```

---

## Xcode Configuration (after `cap add ios`)

- Bundle Identifier: `dev.behrman.tippal`
- Display Name: `TIP Pal`
- Deployment Target: iOS 16.0
- Signing: requires Apple Developer account — enroll when this step is reached

---

## Android Configuration (after `cap add android`)

- Application ID: `dev.behrman.tippal`
- Target SDK: 34 (Android 14)
- Min SDK: 23 (Android 6.0)

---

## Files NOT Changed

- `app/daily/page.tsx` — no change
- `lib/supabase.ts` — no change
- `lib/types.ts` — no change
- All history, onboarding, login pages — no change
- Supabase dashboard — anon key CORS is open by default; no origin configuration needed

---

## Acceptance Criteria Verification Checklist

- [ ] `npm run build` (web) still succeeds — no regressions
- [ ] `npm run build:native` succeeds — `out/` directory generated
- [ ] `npx cap sync` completes without errors
- [ ] iOS Simulator: app launches, all navigation works, no console errors
- [ ] iOS Simulator: parse schedule → daily view flow works end-to-end (uses live Vercel API)
- [ ] iOS Simulator: Settings page — no notification section visible
- [ ] Android Emulator: same verification
- [ ] App icon visible on simulator home screen (placeholder acceptable)
- [ ] Splash screen appears on launch (placeholder acceptable)
