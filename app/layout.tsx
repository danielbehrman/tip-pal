import type { Metadata, Viewport } from "next"
import "./globals.css"
import SignOutButton from "@/components/SignOutButton"
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister"
import BottomNav from "@/components/BottomNav"

export const metadata: Metadata = {
  title: "Tip Pal",
  manifest: "/manifest.json",
  icons: {
    icon: "/icons/icon-192.webp",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tip Pal",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ff6b35",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <ServiceWorkerRegister />
        <div className="app-container">
          <SignOutButton />
          <div style={{ paddingBottom: 90 }}>
            {children}
          </div>
          <BottomNav />
        </div>
      </body>
    </html>
  )
}
