import Link from "next/link"

export const metadata = {
  title: "Medical Disclaimer — Tip Pal",
}

export default function DisclaimerPage() {
  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold mb-8">Medical Disclaimer</h1>

      <p className="text-sm text-gray-700 leading-relaxed mb-8">
        Tip Pal is not a medical device. It is not affiliated with the Food Allergy Institute
        or the Tolerance Induction Program. Always follow your provider&apos;s instructions.
      </p>

      <p className="text-sm text-gray-700 leading-relaxed mb-10">
        Tip Pal is a scheduling aid only. It does not provide medical advice, adjust doses,
        or make clinical decisions. All dosing information comes from your care team&apos;s plan of care.
        If you have questions about your protocol, contact your clinical team directly.
      </p>

      <Link href="/privacy" className="text-sm text-gray-400 underline block mb-2">
        Privacy policy
      </Link>
      <Link href="/login" className="text-sm text-gray-400 underline block">
        ← Back to app
      </Link>
    </main>
  )
}
