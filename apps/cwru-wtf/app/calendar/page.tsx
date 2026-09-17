import type { Metadata } from "next"
import Link from "next/link"
import { ArrowLeft, CalendarPlus, Rss } from "lucide-react"
import { Button } from "@/components/ui/button"
import CalendarEmbed from "@/components/calendar-embed"
import Wordmark from "@/components/wordmark"

const CALENDAR_ID =
  "c_2c86f339e7d304f3f3ca3c9cf9150f0fa0280197ba78e891d3bb56f0e3a621d9@group.calendar.google.com"

const subscribeUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(CALENDAR_ID)}`
const icalUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(CALENDAR_ID)}/public/basic.ics`

export const metadata: Metadata = {
  title: "Calendar - CWRU.WTF",
  description: "Everything CWRU.WTF is running.",
}

export default function CalendarPage() {
  return (
    <div className="min-h-[100svh] bg-background text-foreground">
      <a
        href="#calendar-main"
        className="focus-ring sr-only z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:fixed focus:left-4 focus:top-4 focus:not-sr-only"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-[100svh] w-full max-w-[1160px] flex-col px-6">
        <header className="flex min-h-20 items-center justify-between gap-4 py-4">
          <Link
            href="/"
            className="focus-ring inline-flex min-h-11 items-center gap-3 rounded-lg text-foreground"
          >
            <ArrowLeft
              aria-hidden="true"
              className="h-4 w-4 text-muted-foreground"
            />
            <span className="font-brand text-lg font-semibold">
              <Wordmark />
            </span>
          </Link>
          <span className="rounded-md bg-muted px-2 py-1 font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
            Calendar
          </span>
        </header>

        <main id="calendar-main" className="flex-1 py-14 md:py-20">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="max-w-content">
              <h1 className="font-brand text-page-title text-foreground">
                Calendar
              </h1>
              <p className="mt-5 text-pretty font-primary text-body text-muted-foreground md:text-lg">
                Everything we&apos;re running, all times Eastern.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:w-[260px]">
              <Button asChild size="lg" className="w-full">
                <a href={subscribeUrl} target="_blank" rel="noreferrer">
                  <CalendarPlus className="h-4 w-4" />
                  Add to Google Calendar
                </a>
              </Button>
              <Button asChild size="lg" variant="outline" className="w-full">
                <a href={icalUrl} target="_blank" rel="noreferrer">
                  <Rss className="h-4 w-4" />
                  iCal feed
                </a>
              </Button>
            </div>
          </div>

          <div className="mt-10">
            <CalendarEmbed />
          </div>
        </main>

        <footer className="screen-line-before flex flex-col items-center gap-2 py-8 text-center sm:flex-row sm:justify-between sm:text-left">
          <span className="font-brand text-lg font-semibold text-foreground">
            <Wordmark />
          </span>
          <span className="font-mono text-caption text-muted-foreground">
            We Tinker Fearlessly
          </span>
        </footer>
      </div>
    </div>
  )
}
