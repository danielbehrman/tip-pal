import type { Metadata, Viewport } from "next"
import "./globals.css"
import SignOutButton from "@/components/SignOutButton"
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister"

export const metadata: Metadata = {
  title: "TIP Pal",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TIP Pal",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f172a",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-white text-gray-900">
        <ServiceWorkerRegister />
        <SignOutButton />
        {children}
      </body>
    </html>
  )
}
