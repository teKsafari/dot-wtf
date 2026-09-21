"use client"

import Script from "next/script"

// The form paints its own #121211 background, which is exactly the site's
// dark-mode background, so the embed reads as part of the page there while
// staying legible on the light theme. transparentBackground would break the
// light theme: the form's text is fixed near-white.
const embedUrl = "https://tally.so/embed/lbp7OX?alignLeft=1&dynamicHeight=1"

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
    <>
      <iframe
        data-tally-src={embedUrl}
        height="500"
        title="Join CWRU.WTF application form"
        className="mx-auto block w-full max-w-[700px] rounded-xl border-0"
        style={{ colorScheme: "dark" }}
      />
      <Script
        src="https://tally.so/widgets/embed.js"
        strategy="lazyOnload"
        onReady={loadEmbeds}
        onError={loadEmbeds}
      />
    </>
  )
}
