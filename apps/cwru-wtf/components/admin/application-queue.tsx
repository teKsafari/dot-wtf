"use client"

import { useCallback, useEffect, useState } from "react"
import { LoaderCircle, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ApplicationQueue as Queue, ApplicationView, SignInLink } from "@/lib/application-fields"
import { socialLinkLabels } from "@/lib/member-profile-fields"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
})

type Action = "approve" | "reject" | "remint-link"

async function review(userId: string, action: Action) {
  const response = await fetch(`/api/admin/applications/${userId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "That action did not go through.")
  }
  return body as { application?: ApplicationView; link?: SignInLink }
}

function Answer({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-sm leading-relaxed">{children}</dd>
    </div>
  )
}

function SignInLinkPanel({ link, onRemint, busy }: {
  link: SignInLink
  onRemint: () => void
  busy: boolean
}) {
  return (
    <div className="mt-5 rounded-lg border border-foreground/30 bg-muted/40 p-4">
      <p className="text-sm font-medium">Send this sign-in link to the member</p>
      <p className="mt-2 break-all font-mono text-sm">{link.url}</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Single use. Expires {dateFormatter.format(new Date(link.expiresAt))}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard?.writeText(link.url).then(
              () => toast.success("Link copied."),
              () => toast.error("Copy the link by hand."),
            )
          }}
        >
          Copy link
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRemint}>
          {busy ? "Minting…" : "Mint a new link"}
        </Button>
      </div>
    </div>
  )
}

export default function ApplicationQueue({ canReview }: { canReview: boolean }) {
  const [queue, setQueue] = useState<Queue | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [links, setLinks] = useState<Record<string, SignInLink>>({})
  const [isLoading, setIsLoading] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const response = await fetch("/api/admin/applications", { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "The queue did not load.")
      setQueue(body as Queue)
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The queue did not load.")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function run(application: ApplicationView, action: Action) {
    setBusyId(application.userId)
    try {
      const result = await review(application.userId, action)
      if (action === "reject") {
        setQueue((current) => current && {
          ...current,
          pending: current.pending.filter((entry) => entry.userId !== application.userId),
        })
        toast.success("Application rejected.")
      } else if (result.link) {
        setLinks((current) => ({ ...current, [application.userId]: result.link! }))
        if (action === "approve" && result.application) {
          const approved = result.application
          setQueue((current) => current && {
            pending: current.pending.filter((entry) => entry.userId !== approved.userId),
            recentlyApproved: [approved, ...current.recentlyApproved],
          })
          toast.success(`Approved as member ${approved.memberNumber ?? ""}.`.trim())
        } else {
          toast.success("New link minted.")
        }
      }
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "That action did not go through.")
    } finally {
      setBusyId(null)
    }
  }

  function Card({ application }: { application: ApplicationView }) {
    const link = links[application.userId]
    const busy = busyId === application.userId
    const approved = application.status === "approved"
    return (
      <li className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row">
          {application.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={application.photoUrl}
              alt={`Photo sent by ${application.fields.name}`}
              className="h-40 w-40 shrink-0 rounded-lg border border-border object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="truncate text-lg font-semibold tracking-tight">{application.fields.name}</h3>
              <p className="text-sm text-muted-foreground">
                {application.submittedAt ? dateFormatter.format(new Date(application.submittedAt)) : "No date"}
              </p>
            </div>
            <p className="mt-1 break-words text-sm text-muted-foreground">{application.email}</p>
            {approved ? (
              <p className="mt-2 text-sm font-medium">Approved as member {application.memberNumber}</p>
            ) : null}

            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Answer label="Institution">{application.fields.institution}</Answer>
              <Answer label="WhatsApp">{application.fields.whatsapp}</Answer>
              <Answer label="Into">
                {[...application.fields.categories, application.fields.otherCategory].filter(Boolean).join(", ")}
              </Answer>
              <Answer label="Portfolio">{application.fields.portfolio}</Answer>
              <Answer label="Bio">{application.fields.bio}</Answer>
              <Answer label="Video">{application.fields.youtubeLink}</Answer>
            </dl>
            <dl className="mt-4 grid gap-4">
              <Answer label="WTF idea">{application.fields.wtfIdea}</Answer>
              <Answer label="Current project">{application.fields.currentProject}</Answer>
              <Answer label="Links">
                {(["github", "instagram", "linkedin"] as const)
                  .filter((platform) => application.fields[platform])
                  .map((platform) => `${socialLinkLabels[platform]}: ${application.fields[platform]}`)
                  .join("\n")}
              </Answer>
            </dl>
          </div>
        </div>

        {link ? (
          <SignInLinkPanel link={link} busy={busy} onRemint={() => void run(application, "remint-link")} />
        ) : null}

        {canReview && !approved ? (
          <div className="mt-5 flex flex-wrap gap-3 border-t border-border pt-5">
            <Button type="button" disabled={busy} onClick={() => void run(application, "approve")}>
              {busy ? "Working…" : "Approve and create their Club ID"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(application, "reject")}>
              Reject
            </Button>
          </div>
        ) : null}

        {canReview && approved && !link ? (
          <div className="mt-5 border-t border-border pt-5">
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(application, "remint-link")}>
              {busy ? "Minting…" : "Mint a sign-in link"}
            </Button>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <div className="px-4 pb-16 sm:px-6 lg:px-0">
      <div className="flex h-[72px] items-center justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Review queue</h1>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw aria-hidden="true" className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      {queue === null && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading the queue…
        </p>
      ) : null}

      {queue ? (
        <>
          {queue.pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications are waiting.</p>
          ) : (
            <ul className="grid gap-6">
              {queue.pending.map((application) => <Card key={application.userId} application={application} />)}
            </ul>
          )}

          {queue.recentlyApproved.length > 0 ? (
            <section className="mt-12">
              <h2 className="text-base font-semibold tracking-tight">Approved in the last two weeks</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A sign-in link is single use. Mint another here when someone loses theirs.
              </p>
              <ul className="mt-6 grid gap-6">
                {queue.recentlyApproved.map((application) => <Card key={application.userId} application={application} />)}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
