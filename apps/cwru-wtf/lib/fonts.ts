import { Nunito, Geist_Mono } from "next/font/google"

/// One typeface everywhere: SF Pro Rounded.
///
/// The stack in tailwind.config.ts asks for it by name and via `ui-rounded`,
/// which covers every Apple platform. Nunito is only the fallback for browsers
/// that have neither — Apple's font licence does not permit serving SF Pro as
/// a webfont, so it cannot be self-hosted for them.
export const fontRounded = Nunito({
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-rounded",
})

export const fontMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
})
