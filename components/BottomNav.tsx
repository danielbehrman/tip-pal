"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const TABS = [
  { label: "Today", href: "/daily", icon: "⊙" },
  { label: "History", href: "/history", icon: "◷" },
  { label: "Rec. Foods", href: "/foods", icon: "✦" },
  { label: "Settings", href: "/settings", icon: "⚙" },
] as const

const HIDDEN_ROUTES = new Set(["/login", "/setup", "/onboarding", "/", "/privacy", "/disclaimer"])

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
        paddingTop: 8,
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 10px)",
        zIndex: 50,
      }}
    >
      {TABS.map(tab => {
        const active = pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex-1 flex flex-col items-center gap-1 py-2 no-underline"
            style={{
              color: active ? "#ff6b35" : "#e0c4b8",
              fontWeight: active ? 500 : 400,
              fontSize: 12,
            }}
          >
            <span style={{ fontSize: 24 }}>{tab.icon}</span>
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
