"use client"

import Script from "next/script"
import { ArrowUpRight } from "lucide-react"

const formUrl = "https://forms.teksafari.com/join-dot-wtf"
const embedUrl =
  "https://tally.so/embed/lbp7OX?alignLeft=1&transparentBackground=1&dynamicHeight=1"

declare global {
  interface Window {
    Tally?: { loadEmbeds: () => void }
  }
}

// The widget script fills in each iframe's src from data-tally-src and then
// keeps its height in step with the form, so validation errors, conditional
// questions and the submission screen never scroll inside a fixed box. If the
// script is blocked, fall back to loading the form directly at the fallback
// height, the same way Tally's own snippet does.
const loadEmbeds = () => {
  if (window.Tally) {
    window.Tally.loadEmbeds()
    return
  }
  document
    .querySelectorAll<HTMLIFrameElement>("iframe[data-tally-src]:not([src])")
    .forEach((iframe) => {
      iframe.src = iframe.dataset.tallySrc ?? ""
    })
}

export default function TallyApplicationForm() {
  return (
    <div className="mx-auto w-full max-w-[700px] corner-squircle overflow-hidden rounded-xl bg-[#121211] p-5 sm:p-10">
      <iframe
        data-tally-src={embedUrl}
        height="500"
        title="Join CWRU.WTF application form"
        className="block w-full border-0"
        style={{ colorScheme: "dark" }}
      />
      <Script
        src="https://tally.so/widgets/embed.js"
        strategy="lazyOnload"
        onReady={loadEmbeds}
        onError={loadEmbeds}
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
