"use client"

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import Link from "next/link"
import * as Avatar from "@radix-ui/react-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  categoryOptions,
  profileFieldsFromFormData,
  profileLimits,
  socialLinkLabels,
  type ApplicationStatus,
  type ProfileField,
  type ProfileFields,
  type ProfileFormState,
} from "@/lib/member-profile-fields"
import { cn } from "@/lib/utils"
import { saveProfile } from "./actions"

export function ProfileSubmitButton({
  children,
  pendingLabel,
  variant = "default",
}: {
  children: ReactNode
  pendingLabel: string
  variant?: "default" | "outline"
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" variant={variant} disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </Button>
  )
}

const avatarSizes = { sm: "size-12 text-base", lg: "mx-auto size-24 text-2xl" }

export function ProfileAvatar({ name, picture, size = "lg" }: {
  name: string
  picture: string | null
  size?: keyof typeof avatarSizes
}) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase() || "?"
  return (
    <Avatar.Root className={cn("flex shrink-0 overflow-hidden rounded-full bg-muted font-brand font-semibold", avatarSizes[size])}>
      {picture ? <Avatar.Image src={picture} alt={`${name}’s profile picture`} referrerPolicy="no-referrer" className="size-full object-cover" /> : null}
      <Avatar.Fallback className="flex size-full items-center justify-center text-muted-foreground" aria-label={`${name}’s profile picture`}>
        {initials}
      </Avatar.Fallback>
    </Avatar.Root>
  )
}

interface FieldConfig {
  name: Exclude<ProfileField, "categories">
  label: string
  hint?: string
  maxLength: number
  rows?: number
  placeholder?: string
  type?: "text" | "url" | "tel"
  autoComplete?: string
  requiredForApplication?: boolean
}

const detailFields: FieldConfig[] = [
  { name: "name", label: "Name", maxLength: profileLimits.name, autoComplete: "name", placeholder: "What should we call you?", requiredForApplication: true },
  { name: "institution", label: "Institution name + location", maxLength: profileLimits.institution, autoComplete: "organization", placeholder: "Your school or institution, city", requiredForApplication: true },
  { name: "whatsapp", label: "WhatsApp", hint: "Our community hangs out on WhatsApp. Include your country code so we can reach you.", maxLength: profileLimits.phone, type: "tel", autoComplete: "tel", placeholder: "+1 555 000 0000", requiredForApplication: true },
  { name: "portfolio", label: "Portfolio or personal website", hint: "A place to see what you make. A full link or a domain both work.", maxLength: profileLimits.link, placeholder: "yoursite.com", requiredForApplication: true },
]

const linkFields: FieldConfig[] = [
  { name: "github", label: socialLinkLabels.github, placeholder: "username", maxLength: profileLimits.social },
  { name: "instagram", label: socialLinkLabels.instagram, placeholder: "@username", maxLength: profileLimits.social },
  { name: "linkedin", label: socialLinkLabels.linkedin, placeholder: "linkedin.com/in/you", maxLength: profileLimits.social },
]

const applicationFields: FieldConfig[] = [
  { name: "wtfIdea", label: "Your WTF idea", hint: "Something you want to explore, create, or build. Keep your application answer to 600 characters.", maxLength: profileLimits.text, rows: 4, placeholder: "What do you want to build that would make you go WTF?", requiredForApplication: true },
  { name: "currentProject", label: "Current project", hint: "Something you have built or are building right now. Keep your application answer to 600 characters.", maxLength: profileLimits.text, rows: 4, requiredForApplication: true },
  { name: "youtubeLink", label: "A video you find interesting", hint: "A short film, lecture, podcast, music video, or anything else. Just be yourself.", maxLength: profileLimits.link, type: "url", placeholder: "https://…", requiredForApplication: true },
]

function ProfileInput({ field, state, idPrefix }: { field: FieldConfig; state: ProfileFormState; idPrefix: string }) {
  const error = state.errors?.[field.name]
  const inputId = `${idPrefix}-${field.name}`
  const hintId = field.hint ? `${inputId}-hint` : null
  const errorId = `${inputId}-error`
  const common = {
    id: inputId,
    name: field.name,
    defaultValue: state.fields[field.name],
    maxLength: field.maxLength,
    invalid: Boolean(error),
    "aria-required": field.requiredForApplication || undefined,
    "aria-describedby": [hintId, error ? errorId : null].filter(Boolean).join(" ") || undefined,
    placeholder: field.placeholder,
  }
  const isIdentity = field.name === "name" || field.name === "institution"
  return (
    <div>
      <Label htmlFor={inputId}>{field.label}{field.requiredForApplication ? <span aria-hidden="true" className="ml-1 text-muted-foreground">*</span> : null}</Label>
      {hintId ? <p id={hintId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{field.hint}</p> : null}
      {field.rows ? (
        <Textarea {...common} rows={field.rows} className="mt-3" />
      ) : (
        <Input
          {...common}
          type={field.type ?? "text"}
          inputMode={field.type === "tel" ? "tel" : isIdentity ? "text" : "url"}
          autoCapitalize={isIdentity ? "words" : "none"}
          autoComplete={field.autoComplete ?? "off"}
          spellCheck={isIdentity}
          className="mt-3"
        />
      )}
      {error ? <p id={errorId} className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

function CategoryFields({ state, idPrefix }: { state: ProfileFormState; idPrefix: string }) {
  const [showOther, setShowOther] = useState(state.fields.categories.includes("Other"))
  useEffect(() => { setShowOther(state.fields.categories.includes("Other")) }, [state.fields])
  const error = state.errors?.categories
  return (
    <fieldset className="min-w-0" aria-describedby={`${idPrefix}-categories-hint${error ? ` ${idPrefix}-categories-error` : ""}`}>
      <legend className="text-sm font-medium">What&apos;s your thing? <span aria-hidden="true" className="text-muted-foreground">*</span></legend>
      <p id={`${idPrefix}-categories-hint`} className="mt-1.5 text-sm text-muted-foreground">Pick as many as you like. Curiosity doesn&apos;t need a single label.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {categoryOptions.map((category, index) => (
          <label key={category} className="corner-squircle flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm transition-colors has-[:checked]:border-foreground/40 has-[:checked]:bg-muted has-[:disabled]:cursor-wait has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/25">
            <input
              id={index === 0 ? `${idPrefix}-categories` : `${idPrefix}-categories-${index}`}
              type="checkbox"
              name="categories"
              value={category}
              defaultChecked={state.fields.categories.includes(category)}
              onChange={category === "Other" ? (event) => setShowOther(event.target.checked) : undefined}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${idPrefix}-categories-error` : undefined}
              className="size-4 shrink-0 accent-foreground"
            />
            <span>{category}</span>
          </label>
        ))}
      </div>
      {error ? <p id={`${idPrefix}-categories-error`} className="mt-2 text-sm text-destructive">{error}</p> : null}
      {/* Keep the field mounted so switching Other off and on does not lose a draft. */}
      <div hidden={!showOther} className="mt-4">
        <ProfileInput field={{ name: "otherCategory", label: "Other category", maxLength: profileLimits.category, placeholder: "Tell us what else you are into", requiredForApplication: showOther }} state={state} idPrefix={idPrefix} />
      </div>
    </fieldset>
  )
}

const statusContent: Record<ApplicationStatus, { label: string; description: string }> = {
  draft: { label: "Your profile, in progress", description: "Take your time. Save a draft, then send your application when it feels like you." },
  pending: { label: "Application under review", description: "Your application is with the team. You can keep your details up to date while you wait." },
  approved: { label: "You’re a member", description: "Welcome in. Your profile is part of the member directory, and you can meet the rest of the community." },
  rejected: { label: "Application not approved", description: "You can update your answers and send your application for another review." },
  suspended: { label: "Membership suspended", description: "Directory access is paused. You can still update your profile; contact the team about your membership." },
}

function MembershipStatus({ status, memberNumber, submittedAt }: {
  status: ApplicationStatus
  memberNumber: number | null
  submittedAt: string | null
}) {
  const content = statusContent[status]
  const date = submittedAt && !Number.isNaN(Date.parse(submittedAt))
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(submittedAt))
    : null
  return (
    <section aria-label="Membership status" className="corner-squircle rounded-2xl border border-border bg-muted/50 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <span aria-hidden="true" className={cn("size-2 rounded-full", status === "approved" ? "bg-success" : "bg-muted-foreground")} />
          {content.label}
        </p>
        {memberNumber !== null ? <p className="font-mono text-xs text-muted-foreground">Member #{memberNumber}</p> : null}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{content.description}</p>
      {status === "pending" && date ? <p className="mt-3 text-xs text-muted-foreground">Submitted {date}</p> : null}
      {status === "approved" ? (
        <Link href="/members" className="focus-ring mt-3 inline-flex min-h-10 items-center rounded-sm text-sm font-medium text-link underline underline-offset-4">Meet the members</Link>
      ) : null}
    </section>
  )
}

async function saveProfileOrKeepInput(previous: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  try {
    return await saveProfile(previous, formData)
  } catch {
    return {
      status: "error",
      fields: profileFieldsFromFormData(formData),
      applicationStatus: previous.applicationStatus,
      memberNumber: previous.memberNumber,
      message: "We couldn’t reach dot*WTF. Your answers are still here. Check your connection and try again.",
    }
  }
}

export function ProfileForm({ initialFields, status, email, emailVerified, memberNumber, submittedAt }: {
  initialFields: ProfileFields
  status: ApplicationStatus
  email: string
  emailVerified: boolean
  memberNumber: number | null
  submittedAt: string | null
}) {
  const [state, formAction, pending] = useActionState(saveProfileOrKeepInput, {
    status: "idle", fields: initialFields, applicationStatus: status, memberNumber,
  } satisfies ProfileFormState)
  const id = useId()
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)
  const focusedOnSubmit = useRef<HTMLElement | null>(null)
  const submitIntent = useRef("save")
  const applicationStatus = state.applicationStatus ?? status
  const currentMemberNumber = state.memberNumber === undefined ? memberNumber : state.memberNumber
  const canSubmit = applicationStatus === "draft" || applicationStatus === "rejected"

  useEffect(() => { if (state.status === "saved") router.refresh() }, [state, router])
  useEffect(() => {
    if (pending) return
    const element = focusedOnSubmit.current
    focusedOnSubmit.current = null
    if (state.status === "invalid") {
      const invalid = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      if (invalid) { invalid.focus(); return }
    }
    if (element?.isConnected && (document.activeElement === document.body || !document.activeElement)) element.focus()
  }, [state, pending])

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        focusedOnSubmit.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const submitter = (event.nativeEvent as SubmitEvent).submitter
        submitIntent.current = submitter instanceof HTMLButtonElement ? submitter.value : "save"
      }}
      className="flex flex-col gap-8 text-left"
      noValidate
    >
      <MembershipStatus status={applicationStatus} memberNumber={currentMemberNumber} submittedAt={submittedAt} />
      <p className="text-sm text-muted-foreground">Fields marked <span aria-hidden="true">*</span><span className="sr-only">with an asterisk</span> are needed to submit your application. You can save an unfinished draft.</p>
      {/* Lock inputs until the action settles so React's form reset cannot discard new typing. */}
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-10">
        <section aria-labelledby={`${id}-details-heading`} className="flex flex-col gap-6">
          <h2 id={`${id}-details-heading`} className="font-brand text-section-title">Your details</h2>
          <ProfileInput field={detailFields[0]} state={state} idPrefix={id} />
          <div>
            <Label htmlFor={`${id}-email`}>Email</Label>
            <Input id={`${id}-email`} value={email} readOnly type="email" autoComplete="email" aria-describedby={`${id}-email-hint`} className="mt-3 bg-muted/60" />
            <p id={`${id}-email-hint`} className="mt-2 text-sm text-muted-foreground">Your sign-in email. {emailVerified ? "Verified with tekID." : "Verify it in tekID before submitting your application."}</p>
            {!emailVerified ? (
              <a href="https://id.teksafari.org/account/security" target="_blank" rel="noopener noreferrer" className="focus-ring mt-2 inline-flex min-h-10 items-center rounded-sm text-sm text-link underline underline-offset-4">Verify your email in tekID</a>
            ) : null}
          </div>
          {detailFields.slice(1).map((field) => <ProfileInput key={field.name} field={field} state={state} idPrefix={id} />)}
        </section>

        <section aria-labelledby={`${id}-application-heading`} className="flex flex-col gap-6 border-t border-border pt-8">
          <div>
            <h2 id={`${id}-application-heading`} className="font-brand text-section-title">What makes you, you</h2>
            <p className="mt-2 text-sm text-muted-foreground">Tell us what you are curious about. Your application answers are shared with the review team.</p>
          </div>
          <CategoryFields state={state} idPrefix={id} />
          {applicationFields.map((field) => <ProfileInput key={field.name} field={field} state={state} idPrefix={id} />)}
        </section>

        <section aria-labelledby={`${id}-card-heading`} className="flex flex-col gap-6 border-t border-border pt-8">
          <div>
            <h2 id={`${id}-card-heading`} className="font-brand text-section-title">Your member card</h2>
            <p className="mt-2 text-sm text-muted-foreground">Once approved, other members see your name, photo, member number, bio, and links. These extras are optional.</p>
          </div>
          <ProfileInput field={{ name: "bio", label: "Bio", maxLength: profileLimits.bio, rows: 3, placeholder: "A little about you and the things you make." }} state={state} idPrefix={id} />
          <div className="grid gap-5 sm:grid-cols-2">
            {linkFields.map((field) => <ProfileInput key={field.name} field={field} state={state} idPrefix={id} />)}
          </div>
          <p className="text-sm text-muted-foreground">Your portfolio link from above appears on your member card too.</p>
        </section>
      </fieldset>

      <div className="border-t border-border pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" name="intent" value="save" size="lg" variant={canSubmit ? "outline" : "default"} disabled={pending} aria-busy={pending && submitIntent.current === "save"}>
            {pending && submitIntent.current === "save" ? "Saving…" : canSubmit ? "Save draft" : "Save changes"}
          </Button>
          {canSubmit || applicationStatus === "suspended" ? (
            <Button type="submit" name="intent" value="submit" size="lg" disabled={pending || !emailVerified || applicationStatus === "suspended"} aria-busy={pending && submitIntent.current === "submit"}>
              {pending && submitIntent.current === "submit" ? "Submitting…" : applicationStatus === "rejected" ? "Resubmit application" : "Submit for approval"}
            </Button>
          ) : null}
        </div>
        <p aria-live="polite" aria-atomic="true" className={cn("mt-3 text-sm", state.status === "saved" ? "text-success" : "text-destructive")}>
          {pending ? null : state.message}
        </p>
        {canSubmit && !emailVerified ? <p className="mt-3 text-sm text-muted-foreground">You can save now. After verifying your email in tekID, sign out and sign in again to submit.</p> : null}
      </div>
    </form>
  )
}
