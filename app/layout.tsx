import type { Metadata, Viewport } from "next"
import "./globals.css"
import SignOutButton from "@/components/SignOutButton"

export const metadata: Metadata = {
  title: "Joshy's Doses",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900">
        <SignOutButton />
        {children}
      </body>
    </html>
  )
}
