"use client"

import { ParsedSchedule } from "@/lib/types"

interface NewCycleReviewProps {
  currentSchedule: ParsedSchedule | null
  newSchedule: ParsedSchedule
  onBack: () => void
  onConfirm: () => void
  confirming: boolean
}

export default function NewCycleReview({
  onBack,
  onConfirm,
  confirming,
}: NewCycleReviewProps) {
  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="text-sm text-slate-600 underline text-left">
        ← Edit pasted text
      </button>
      <p className="text-gray-500 text-sm">Review coming in Task 4.</p>
      <button
        onClick={onConfirm}
        disabled={confirming}
        className="w-full py-4 bg-slate-900 text-white text-lg font-semibold rounded-xl disabled:opacity-50"
      >
        {confirming ? "Saving…" : "Confirm & Start New Cycle"}
      </button>
    </div>
  )
}
