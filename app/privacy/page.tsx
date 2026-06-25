import Link from "next/link"

export const metadata = {
  title: "Privacy Policy — Tip Pal",
}

export default function PrivacyPage() {
  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-1">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">Effective: June 25, 2026</p>

      <section className="mb-6">
        <h2 className="text-base font-semibold mb-2">What we store</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          Tip Pal stores your account email address and your family&apos;s food and dose schedule.
          This includes food names, doses, units, timing preferences, notification settings, and dosing history.
          No patient names, dates of birth, phone numbers, or other personal information are collected or stored.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold mb-2">What we do not do</h2>
        <ul className="text-sm text-gray-700 leading-relaxed list-disc list-inside space-y-1">
          <li>We do not sell your data.</li>
          <li>We do not share your data with third parties for marketing.</li>
          <li>We do not use your data for advertising.</li>
          <li>We do not store raw plan-of-care documents. Text you paste for schedule parsing is processed server-side and immediately discarded after parsing — only the structured schedule is saved.</li>
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold mb-2">Schedule parsing</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          When you paste a plan of care to parse your schedule, the raw document text is processed
          server-side and immediately discarded — it is never logged or stored. Before the text reaches
          the AI parser, an automated pass removes common personal information: labeled fields
          (Patient, Date of Birth, Provider, Phone, etc.), phone numbers, email addresses, and similar
          identifiers. The AI is also explicitly instructed to extract food and medication dosing
          information only and to ignore any remaining patient or provider details. Only the resulting
          structured schedule — food names, doses, and units — is saved to your account.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold mb-2">Data processor</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          Your data is stored in Supabase (Supabase, Inc.), a hosted database and authentication service.
          Supabase acts as our data processor and stores data in accordance with their own privacy policy.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="text-base font-semibold mb-2">Account deletion</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          Deleting your account permanently removes all associated data — your schedule, dosing history,
          notification settings, and account credentials. This action cannot be undone.
          To request account deletion, contact us at the address below.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-base font-semibold mb-2">Contact</h2>
        <p className="text-sm text-gray-700 leading-relaxed">
          Questions about this policy: daniel@behrman.dev
        </p>
      </section>

      <Link href="/disclaimer" className="text-sm text-gray-400 underline block mb-2">
        Medical disclaimer
      </Link>
      <Link href="/login" className="text-sm text-gray-400 underline block">
        ← Back to app
      </Link>
    </main>
  )
}
