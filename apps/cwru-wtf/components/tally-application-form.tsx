"use client"

import Script from "next/script"
import { ArrowUpRight } from "lucide-react"

const formUrl = "https://forms.teksafari.com/join-dot-wtf"
const embedUrl = "https://tally.so/embed/lbp7OX?alignLeft=1&dynamicHeight=1"

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void }
  }
}

export default function TallyApplicationForm() {
  return (
    <div className="mx-auto w-full max-w-[700px] corner-squircle overflow-hidden rounded-xl bg-[#121211] p-5 sm:p-10">
      <iframe
        src={embedUrl}
        loading="eager"
        width="100%"
        height="1520"
        title="Join CWRU.WTF application form"
        className="block border-0"
        style={{ colorScheme: "dark" }}
      />
      <Script
        src="https://tally.so/widgets/embed.js"
        strategy="lazyOnload"
        onReady={() => window.Tally?.loadEmbeds()}
      />
      <a
        href={formUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex min-h-11 items-center gap-1 font-nunito text-sm text-[#a2a19a] underline-offset-4 hover:text-[#eeeeed] hover:underline focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#eeeeed]"
      >
        Open application in a new tab
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  )
}
