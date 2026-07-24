"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ParsedSchedule, DoseLogDay } from "@/lib/types"
import {
  getSession,
  fetchSchedule,
  fetchAllDoseLogDays,
  deleteDoseLogDays,
  deleteAllDoseLogDays,
} from "@/lib/supabase"
import DoseHistoryLog from "@/components/DoseHistoryLog"

export default function HistoryPage() {
  const router = useRouter()
  const [schedule, setSchedule] = useState<ParsedSchedule | null>(null)
  const [days, setDays] = useState<DoseLogDay[]>([])
  const [loading, setLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirmTarget, setConfirmTarget] = useState<"selection" | "all" | null>(null)
  const [deleting, setDeleting] = useState(false)

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
        const [s, allDays] = await Promise.all([fetchSchedule(), fetchAllDoseLogDays()])
        if (!s) {
          router.replace("/setup")
          return
        }
        setSchedule(s)
        setDays(allDays)
      } catch {
        router.replace("/daily")
      } finally {
        setLoading(false)
      }
    }
    load()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function handleConfirmDelete() {
    if (!confirmTarget) return
    setDeleting(true)
    try {
      if (confirmTarget === "all") {
        await deleteAllDoseLogDays()
        setDays([])
      } else {
        const ids = [...selectedIds]
        await deleteDoseLogDays(ids)
        setDays(prev => prev.filter(d => !selectedIds.has(d.id)))
      }
      exitSelectMode()
    } catch {
      // Delete failed — leave selection intact so the user can retry
    } finally {
      setDeleting(false)
      setConfirmTarget(null)
    }
  }

  if (loading || !schedule) return null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header
        className="px-4 pb-4"
        style={{ background: "var(--color-primary)", paddingTop: "calc(env(safe-area-inset-top, 0px) + 1.25rem)" }}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-white">History</h1>
          <div className="flex items-center gap-4">
            {!selectMode && (
              <Link
                href="/history/edit"
                className="text-sm font-medium"
                style={{ color: "rgba(255,255,255,0.85)" }}
              >
                Edit
              </Link>
            )}
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className="text-sm font-medium"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          </div>
        </div>
        {selectMode && (
          <div className="flex items-center justify-between mt-3">
            <button
              type="button"
              onClick={() => setConfirmTarget("all")}
              disabled={days.length === 0}
              className="text-sm font-medium disabled:opacity-40"
              style={{ color: "rgba(255,255,255,0.85)" }}
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={() => setConfirmTarget("selection")}
              disabled={selectedIds.size === 0}
              className="text-sm font-semibold disabled:opacity-40"
              style={{ color: "#fff" }}
            >
              Delete{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
            </button>
          </div>
        )}
      </header>
      <DoseHistoryLog
        schedule={schedule}
        days={days}
        selectMode={selectMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />
      {confirmTarget && (
        <div className="fixed inset-0 z-[60] flex items-end" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div
            className="bg-white w-full rounded-t-2xl px-6 pt-6"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
          >
            <p className="text-base font-semibold mb-5" style={{ color: "var(--color-text-primary)" }}>
              {confirmTarget === "all"
                ? `Delete all ${days.length} logged day${days.length !== 1 ? "s" : ""}? This can't be undone.`
                : `Delete ${selectedIds.size} selected day${selectedIds.size !== 1 ? "s" : ""}? This can't be undone.`}
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: "#dc2626", color: "#fff" }}
                onClick={handleConfirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{ background: "var(--color-primary-border)", color: "var(--color-text-primary)" }}
                onClick={() => setConfirmTarget(null)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
