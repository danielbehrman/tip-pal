"use client"

interface CompleteDayConfirmProps {
  unchecked: string[]
  noneChecked: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function CompleteDayConfirm({ unchecked, noneChecked, onConfirm, onCancel }: CompleteDayConfirmProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div
        className="bg-white w-full rounded-t-2xl px-6 pt-6"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
      >
        {noneChecked ? (
          <p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
            No treatment foods were given today — confirm skip?
          </p>
        ) : (
          <div className="mb-5">
            {unchecked.map(name => (
              <p key={name} className="text-base font-semibold mb-1" style={{ color: "var(--color-text-primary)" }}>
                {name} wasn&apos;t checked — skip it today?
              </p>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button
            className="flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--color-primary-mid)", color: "#fff" }}
            onClick={onConfirm}
          >
            Confirm
          </button>
          <button
            className="flex-1 py-3 rounded-xl text-sm font-semibold"
            style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
