"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

const CALENDAR_ID =
  "c_2c86f339e7d304f3f3ca3c9cf9150f0fa0280197ba78e891d3bb56f0e3a621d9@group.calendar.google.com"
const TIME_ZONE = "America/New_York"

const VIEWS = [
  { label: "Agenda", mode: "AGENDA" },
  { label: "Week", mode: "WEEK" },
  { label: "Month", mode: "MONTH" },
] as const

type ViewMode = (typeof VIEWS)[number]["mode"]

function embedUrl(mode: ViewMode) {
  const params = new URLSearchParams({
    src: CALENDAR_ID,
    ctz: TIME_ZONE,
    mode,
    wkst: "1",
    showTitle: "0",
    showPrint: "0",
    showTabs: "0",
    showCalendars: "0",
    showTz: "0",
    bgcolor: "#ffffff",
  })
  return `https://calendar.google.com/calendar/embed?${params.toString()}`
}

export default function CalendarEmbed() {
  const [mode, setMode] = useState<ViewMode>("AGENDA")
  const [isLoading, setIsLoading] = useState(true)

  const selectView = (next: ViewMode) => {
    if (next === mode) return
    setIsLoading(true)
    setMode(next)
  }

  return (
    <div>
      <div
        role="tablist"
        aria-label="Calendar view"
        className="corner-squircle inline-flex gap-1 rounded-xl border border-border bg-card p-1"
      >
        {VIEWS.map((view) => (
          <button
            key={view.mode}
            type="button"
            role="tab"
            aria-selected={mode === view.mode}
            onClick={() => selectView(view.mode)}
            className={cn(
              "focus-ring corner-squircle rounded-lg px-4 py-2 font-primary text-body-sm font-medium transition-colors",
              mode === view.mode
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground"
            )}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="relative mt-5 overflow-hidden rounded-xl border border-border bg-white">
        {isLoading ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
            <span className="font-mono text-caption uppercase tracking-[0.2em] text-neutral-400">
              Loading calendar…
            </span>
          </div>
        ) : null}
        <iframe
          key={mode}
          src={embedUrl(mode)}
          title="CWRU.WTF events calendar"
          onLoad={() => setIsLoading(false)}
          loading="lazy"
          className="block h-[70svh] min-h-[520px] w-full border-0"
        />
      </div>
    </div>
  )
}
