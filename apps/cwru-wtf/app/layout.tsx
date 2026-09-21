import type React from "react"
import "./globals.css"
import type { Metadata } from "next"
import { fontRounded, fontMono } from "@/lib/fonts"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"

export const metadata: Metadata = {
  metadataBase: new URL("https://cwru.wtf"),
  title: "CWRU.WTF - We Tinker Fearlessly",
  description: "A collective of CWRU students building the future (or just building cool stuff).",
  openGraph: {
    title: "CWRU.WTF - We Tinker Fearlessly",
    description: "A collective of CWRU students building the future (or just building cool stuff).",
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: "CWRU.WTF - We Tinker Fearlessly",
    description: "A collective of CWRU students building the future (or just building cool stuff).",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fontRounded.variable} ${fontMono.variable}`}>
      <body className="font-primary antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
          <Toaster
            theme="light"
            position="bottom-right"
            expand={false}
            richColors
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
