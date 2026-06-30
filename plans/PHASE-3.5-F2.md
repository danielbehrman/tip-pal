# Phase 3.5 F2: Header Child Name + Photo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the family name in the daily view header with the child's name, and add an optional child photo to the avatar circle.

**Architecture:** Add `child_name` and `child_photo_url` columns to the `families` table (with migration seeding `child_name` from existing `name`). Create a public Supabase Storage bucket `avatars` for photo storage. Update `fetchFamilyName` to read from `child_name` (falling back to `name`) so all existing callers get the new value automatically. Add dedicated photo helpers (`uploadChildPhoto`, `saveChildPhotoUrl`, `fetchChildPhotoUrl`). Update DailyView avatar, Settings name/photo fields, and Onboarding step 1.

**Tech Stack:** Next.js App Router, Supabase (Postgres + Storage), Tailwind CSS, React hooks

## Global Constraints

- App name is "Tip Pal" — never "TIP Pal" in any user-facing copy
- No personal names in codebase or app (no "Dan", "Josh", etc.)
- All Supabase reads/writes use the anon-key client from `@/lib/supabase` — no service role on the client
- Photo upload: use standard `<input type="file" accept="image/*">` (works in browser and Capacitor WebView without the native Camera plugin; native plugin is future scope)
- Colors: `#ff6b35` orange header, `#fff3ec` avatar inner bg, `#fffbf7` app bg
- DailyView header text: `{childName}'s Tip Pal` where `childName` comes from `fetchFamilyName()` (updated to read `child_name`)
- Multi-child architecture: NOT built. Single child per account. Schema must not block future multi-child (no child ID FK constraints that assume singleton).
- `npm run build` must pass with zero TypeScript errors after each task

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/20260630_child_name_photo.sql` | CREATE — add columns, seed data, create storage bucket + policies |
| `lib/supabase.ts` | MODIFY — update `fetchFamilyName`, `saveFamilyConfig`; add `fetchChildPhotoUrl`, `uploadChildPhoto`, `saveChildPhotoUrl`, `saveChildName` |
| `components/DailyView.tsx` | MODIFY — add `childPhotoUrl` prop; replace 🧒 emoji with photo-or-fallback |
| `app/daily/page.tsx` | MODIFY — fetch `childPhotoUrl`, pass to DailyView |
| `app/settings/page.tsx` | MODIFY — rename familyName→childName UI, add photo upload section |
| `app/onboarding/page.tsx` | MODIFY — rename Family name→Child's name field, add optional photo upload |

---

### Task 1: Migration + Supabase helpers

**Files:**
- Create: `supabase/migrations/20260630_child_name_photo.sql`
- Modify: `lib/supabase.ts`

**Interfaces:**
- Produces:
  - `fetchFamilyName(): Promise<string | null>` — now reads `child_name` with fallback to `name` (backward compat for all callers)
  - `saveChildName(name: string): Promise<void>` — writes `families.child_name`
  - `saveFamilyConfig(name: string, appointmentDate: string | null): Promise<void>` — now also writes `child_name`
  - `uploadChildPhoto(file: File): Promise<string>` — uploads file to `avatars/{familyId}/avatar`, returns public URL
  - `saveChildPhotoUrl(url: string): Promise<void>` — writes `families.child_photo_url`
  - `fetchChildPhotoUrl(): Promise<string | null>` — reads `families.child_photo_url`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260630_child_name_photo.sql`:

```sql
-- Add child_name and child_photo_url to families table
ALTER TABLE families ADD COLUMN IF NOT EXISTS child_name TEXT;
ALTER TABLE families ADD COLUMN IF NOT EXISTS child_photo_url TEXT;

-- Seed child_name from existing name for all existing rows
UPDATE families SET child_name = name WHERE child_name IS NULL AND name IS NOT NULL;

-- Create public avatars storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload to avatars bucket
CREATE POLICY "Authenticated can upload avatars"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Authenticated can update avatars"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars')
  WITH CHECK (bucket_id = 'avatars');

-- Public reads are handled automatically by the public bucket setting
```

- [ ] **Step 2: Apply migration to production Supabase**

Run via Supabase dashboard SQL editor or CLI:
```bash
# Via Supabase CLI (if linked):
supabase db push
# Or paste the SQL directly in the Supabase dashboard SQL editor
```

Verify: the `families` table now has `child_name` and `child_photo_url` columns, and `child_name` is populated for existing rows.

- [ ] **Step 3: Update `fetchFamilyName` to read `child_name` with fallback**

In `lib/supabase.ts`, find the existing `fetchFamilyName` function (currently selects `"name"` from families) and replace with:

```ts
export async function fetchFamilyName(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("child_name, name")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.child_name as string | null) || (data.name as string | null) || null
}
```

- [ ] **Step 4: Update `saveFamilyConfig` to also write `child_name`**

Find the existing `saveFamilyConfig` function (currently writes `{ name, next_appointment_date }`) and replace with:

```ts
export async function saveFamilyConfig(
  name: string,
  appointmentDate: string | null
): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ name, child_name: name, next_appointment_date: appointmentDate })
    .eq("id", familyId)
  if (error) throw error
}
```

- [ ] **Step 5: Add `saveChildName` function**

Add after `saveFamilyName` in `lib/supabase.ts`:

```ts
export async function saveChildName(name: string): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ child_name: name })
    .eq("id", familyId)
  if (error) throw error
}
```

- [ ] **Step 6: Add photo helper functions**

Add after `saveChildName` in `lib/supabase.ts`:

```ts
export async function uploadChildPhoto(file: File): Promise<string> {
  const familyId = await getFamilyId()
  const ext = file.type === "image/png" ? "png" : "jpg"
  const path = `${familyId}/avatar.${ext}`
  const { error } = await getClient()
    .storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type })
  if (error) throw error
  const { data } = getClient().storage.from("avatars").getPublicUrl(path)
  return data.publicUrl
}

export async function saveChildPhotoUrl(url: string): Promise<void> {
  const familyId = await getFamilyId()
  const { error } = await getClient()
    .from("families")
    .update({ child_photo_url: url })
    .eq("id", familyId)
  if (error) throw error
}

export async function fetchChildPhotoUrl(): Promise<string | null> {
  const familyId = await getFamilyId()
  const { data, error } = await getClient()
    .from("families")
    .select("child_photo_url")
    .eq("id", familyId)
    .single()
  if (error) throw error
  return (data.child_photo_url as string | null) || null
}
```

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260630_child_name_photo.sql lib/supabase.ts
git commit -m "feat(f2): add child_name/photo columns, migration, and supabase helpers"
```

---

### Task 2: DailyView avatar photo display + page.tsx wiring

**Files:**
- Modify: `components/DailyView.tsx`
- Modify: `app/daily/page.tsx`

**Interfaces:**
- Consumes: `fetchChildPhotoUrl()` from `@/lib/supabase` (Task 1)
- Produces: DailyView accepts `childPhotoUrl: string | null` prop; avatar circle shows photo if set, 🧒 emoji if not

- [ ] **Step 1: Add `childPhotoUrl` prop to DailyView**

In `components/DailyView.tsx`, add to `DailyViewProps`:

```ts
interface DailyViewProps {
  // ... existing props (do not remove any)
  childPhotoUrl: string | null
}
```

And add `childPhotoUrl` to the destructured params in the function signature.

- [ ] **Step 2: Replace the emoji avatar with photo-or-fallback**

In `components/DailyView.tsx`, find the avatar inner div (currently shows `🧒` emoji) and replace:

```tsx
{/* Avatar inner — child photo or emoji fallback */}
{childPhotoUrl ? (
  <img
    src={childPhotoUrl}
    alt="Child"
    className="absolute rounded-full object-cover"
    style={{ inset: 6 }}
  />
) : (
  <div
    className="absolute rounded-full flex items-center justify-center"
    style={{ inset: 6, background: "#fff3ec", fontSize: 20 }}
  >
    🧒
  </div>
)}
```

- [ ] **Step 3: Update page.tsx to fetch and pass childPhotoUrl**

In `app/daily/page.tsx`:

Add state:
```ts
const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
```

Add `fetchChildPhotoUrl` to the imports from `@/lib/supabase`.

In the `Promise.all` inside `load()`, add the fetch:
```ts
const [ds, apptDate, name, positions, records, groups, vNum, rawProgress, photoUrl] = await Promise.all([
  fetchDoseState(),
  fetchAppointmentDate().catch(() => null),
  fetchFamilyName().catch(() => null),
  fetchCompletedPositions().catch(() => new Set<string>()),
  fetchDayRecords().catch(() => new Map<string, DayRecord>()),
  fetchFoodGroups().catch(() => []),
  fetchVisitNumber().catch(() => null),
  fetchFoodProgress().catch(() => new Map<string, FoodProgress>()),
  fetchChildPhotoUrl().catch(() => null),
])
```

After the state-setting block, add:
```ts
setChildPhotoUrl(photoUrl)
```

Pass to DailyView render:
```tsx
<DailyView
  // ... existing props
  childPhotoUrl={childPhotoUrl}
/>
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add components/DailyView.tsx app/daily/page.tsx
git commit -m "feat(f2): show child photo in DailyView header avatar ring"
```

---

### Task 3: Settings — child name + photo upload

**Files:**
- Modify: `app/settings/page.tsx`

**Interfaces:**
- Consumes: `saveChildName`, `uploadChildPhoto`, `saveChildPhotoUrl`, `fetchChildPhotoUrl` from `@/lib/supabase` (Task 1)

Note: The current settings page uses `familyName` state bound to the "Family name" field and `saveFamilyName` to persist it. This task:
1. Renames that state variable and label to `childName`
2. Changes the save to call `saveChildName` instead of `saveFamilyName`
3. Adds a photo upload section above the name field

- [ ] **Step 1: Update imports**

In `app/settings/page.tsx`, add to the imports from `@/lib/supabase`:
```ts
saveChildName,
uploadChildPhoto,
saveChildPhotoUrl,
fetchChildPhotoUrl,
```

Remove `saveFamilyName` from the import (it's no longer called here; it still exists in supabase.ts for any other caller).

- [ ] **Step 2: Add state for child photo**

Add state variables:
```ts
const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
const [photoUploading, setPhotoUploading] = useState(false)
const photoInputRef = useRef<HTMLInputElement>(null)
```

- [ ] **Step 3: Rename `familyName` state to `childName`**

Rename all occurrences of `familyName` and `setFamilyName` in the settings page to `childName` and `setChildName`. Use replace-all on this file only.

Also rename the `nameError` variable and its usage — keep the name `nameError` (it's still about the name field).

- [ ] **Step 4: Fetch child photo on load**

In the `load()` function, add to the `Promise.all`:
```ts
fetchChildPhotoUrl().catch(() => null),
```

And destructure the result, then:
```ts
setChildPhotoUrl(photoUrl)
```

- [ ] **Step 5: Change save to use `saveChildName`**

Find the save handler that calls `saveFamilyName(familyName.trim())` and update to:
```ts
await saveChildName(childName.trim())
```

- [ ] **Step 6: Add `handlePhotoChange` function**

Add a new function in the component:
```ts
async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  setPhotoUploading(true)
  try {
    const url = await uploadChildPhoto(file)
    await saveChildPhotoUrl(url)
    setChildPhotoUrl(url)
  } catch {
    // Silent — photo upload failure is non-critical
  } finally {
    setPhotoUploading(false)
  }
}
```

- [ ] **Step 7: Add photo upload UI above the name field**

In the JSX, find the name field section. Add above the input label:

```tsx
{/* Child photo */}
<div className="flex flex-col items-center mb-6">
  <button
    type="button"
    className="relative"
    onClick={() => photoInputRef.current?.click()}
    aria-label="Change child photo"
  >
    <div
      className="rounded-full overflow-hidden flex items-center justify-center"
      style={{ width: 80, height: 80, background: "#fff3ec", fontSize: 32 }}
    >
      {childPhotoUrl ? (
        <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
      ) : (
        "🧒"
      )}
    </div>
    <div
      className="absolute bottom-0 right-0 rounded-full flex items-center justify-center"
      style={{ width: 24, height: 24, background: "#ff6b35", fontSize: 13 }}
    >
      {photoUploading ? "…" : "✎"}
    </div>
  </button>
  <p className="text-xs mt-2" style={{ color: "#9a6a55" }}>
    {photoUploading ? "Uploading…" : "Tap to change photo"}
  </p>
  <input
    ref={photoInputRef}
    type="file"
    accept="image/*"
    className="hidden"
    onChange={handlePhotoChange}
  />
</div>
```

- [ ] **Step 8: Update label from "Family name" to "Child's name"**

Find the `<label>` text "Family name" (or similar) and update to "Child's name".

- [ ] **Step 9: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 10: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(f2): settings — child name + photo upload"
```

---

### Task 4: Onboarding — child name + optional photo

**Files:**
- Modify: `app/onboarding/page.tsx`

**Interfaces:**
- Consumes: `uploadChildPhoto`, `saveChildPhotoUrl` from `@/lib/supabase` (Task 1)
- Note: `saveFamilyConfig` already writes `child_name` (updated in Task 1), so the name is persisted correctly through the existing onboarding save flow.

- [ ] **Step 1: Update imports**

Add to imports from `@/lib/supabase`:
```ts
uploadChildPhoto,
saveChildPhotoUrl,
```

- [ ] **Step 2: Rename `familyName` state to `childName`**

Rename all occurrences of `familyName` / `setFamilyName` in the onboarding page to `childName` / `setChildName`. Also update the function call `saveFamilyConfig(familyName.trim(), ...)` → `saveFamilyConfig(childName.trim(), ...)`.

- [ ] **Step 3: Add photo state**

```ts
const [childPhotoUrl, setChildPhotoUrl] = useState<string | null>(null)
const [photoUploading, setPhotoUploading] = useState(false)
const photoInputRef = useRef<HTMLInputElement>(null)
```

Add `useRef` to the React imports if not already present.

- [ ] **Step 4: Add `handlePhotoChange` function**

```ts
async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  if (!file) return
  setPhotoUploading(true)
  try {
    const url = await uploadChildPhoto(file)
    await saveChildPhotoUrl(url)
    setChildPhotoUrl(url)
  } catch {
    // Silent — photo is optional; onboarding still proceeds without it
  } finally {
    setPhotoUploading(false)
  }
}
```

- [ ] **Step 5: Update onboarding UI — step 1 name field**

Find the name input section and update:
1. Change label text from "Family name" (or similar) to "Child's name"
2. Update `value={familyName}` → `value={childName}` and `onChange={(e) => setFamilyName(e.target.value)}` → `onChange={(e) => setChildName(e.target.value)}`
3. Update placeholder if present to e.g. `"e.g. Joshy"`

Add the photo UI above the name input:

```tsx
{/* Optional child photo */}
<div className="flex flex-col items-center mb-6">
  <button
    type="button"
    className="relative"
    onClick={() => photoInputRef.current?.click()}
    aria-label="Add child photo"
  >
    <div
      className="rounded-full overflow-hidden flex items-center justify-center"
      style={{ width: 80, height: 80, background: "#fff3ec", fontSize: 32 }}
    >
      {childPhotoUrl ? (
        <img src={childPhotoUrl} alt="Child" className="w-full h-full object-cover" />
      ) : (
        "🧒"
      )}
    </div>
    {!childPhotoUrl && !photoUploading && (
      <div
        className="absolute bottom-0 right-0 rounded-full flex items-center justify-center"
        style={{ width: 24, height: 24, background: "#ff6b35", fontSize: 13, color: "#fff" }}
      >
        +
      </div>
    )}
  </button>
  <p className="text-xs mt-2" style={{ color: "#9a6a55" }}>
    {photoUploading ? "Uploading…" : "Add a photo (optional)"}
  </p>
  <input
    ref={photoInputRef}
    type="file"
    accept="image/*"
    className="hidden"
    onChange={handlePhotoChange}
  />
</div>
```

- [ ] **Step 6: Full build check**

```bash
npm run build 2>&1 | tail -15
```

Expected: `✓ Compiled successfully`, zero TypeScript errors, all pages generated.

- [ ] **Step 7: Commit**

```bash
git add app/onboarding/page.tsx
git commit -m "feat(f2): onboarding — child name field + optional photo on step 1"
```
