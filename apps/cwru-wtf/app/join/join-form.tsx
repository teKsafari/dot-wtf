"use client"

import { useActionState, useId, useRef, useState } from "react"
import { useFormStatus } from "react-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { applicationHoneypotField } from "@/lib/application-fields"
import { categoryOptions, profileLimits, socialLinkLabels, type ProfileField } from "@/lib/member-profile-fields"
import { cn } from "@/lib/utils"
import { submitApplication } from "./actions"
import { emptyJoinFormState, type JoinFormState } from "./state"

type TextField = {
  name: Exclude<ProfileField, "categories">
  label: string
  hint?: string
  maxLength: number
  rows?: number
  placeholder?: string
  type?: "text" | "url" | "tel"
  autoComplete?: string
  required?: boolean
}

const aboutYou: TextField[] = [
  { name: "name", label: "Name", maxLength: profileLimits.name, autoComplete: "name", placeholder: "What should we call you?", required: true },
  { name: "institution", label: "Institution name + location", maxLength: profileLimits.institution, autoComplete: "organization", placeholder: "Your school or institution, city", required: true },
  { name: "whatsapp", label: "WhatsApp", hint: "Include your country code. The club runs on WhatsApp.", maxLength: profileLimits.phone, type: "tel", autoComplete: "tel", placeholder: "+1 555 000 0000", required: true },
  { name: "portfolio", label: "Portfolio or personal website", hint: "A full link or a bare domain both work.", maxLength: profileLimits.link, placeholder: "yoursite.com", required: true },
  { name: "bio", label: "Short bio", hint: "Optional. Other members see this in the directory.", maxLength: profileLimits.bio, rows: 3 },
]

const yourWork: TextField[] = [
  { name: "wtfIdea", label: "Your WTF idea", hint: "Something you want to explore, create, or build. 600 characters or fewer.", maxLength: profileLimits.applicationText, rows: 4, required: true },
  { name: "currentProject", label: "Current project", hint: "Something you have built or are building. 600 characters or fewer.", maxLength: profileLimits.applicationText, rows: 4, required: true },
  { name: "youtubeLink", label: "A video you find interesting", maxLength: profileLimits.link, type: "url", placeholder: "https://…", required: true },
]

const links: TextField[] = [
  { name: "github", label: socialLinkLabels.github, placeholder: "username", maxLength: profileLimits.social },
  { name: "instagram", label: socialLinkLabels.instagram, placeholder: "@username", maxLength: profileLimits.social },
  { name: "linkedin", label: socialLinkLabels.linkedin, placeholder: "linkedin.com/in/you", maxLength: profileLimits.social },
]

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return <p id={id} role="alert" className="mt-2 text-sm text-destructive">{message}</p>
}

function TextControl({ field, state, prefix }: { field: TextField; state: JoinFormState; prefix: string }) {
  const id = `${prefix}-${field.name}`
  const errorId = `${id}-error`
  const hintId = field.hint ? `${id}-hint` : null
  const error = state.errors?.[field.name]
  const shared = {
    id,
    name: field.name,
    defaultValue: state.fields[field.name],
    maxLength: field.maxLength,
    "aria-invalid": Boolean(error) || undefined,
    "aria-required": field.required || undefined,
    "aria-describedby": [hintId, error ? errorId : null].filter(Boolean).join(" ") || undefined,
    placeholder: field.placeholder,
  }
  return (
    <div>
      <Label htmlFor={id}>
        {field.label}
        {field.required ? <span aria-hidden="true" className="ml-1 text-muted-foreground">*</span> : null}
      </Label>
      {hintId ? <p id={hintId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{field.hint}</p> : null}
      {field.rows
        ? <Textarea {...shared} rows={field.rows} className="mt-3" />
        : <Input {...shared} type={field.type ?? "text"} autoComplete={field.autoComplete ?? "off"} className="mt-3" />}
      <FieldError id={errorId} message={error} />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-8">
      <h2 className="font-brand text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-6 grid gap-6">{children}</div>
    </section>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
      {pending ? "Sending…" : "Send application"}
    </Button>
  )
}

export default function JoinForm() {
  const [state, action] = useActionState(submitApplication, emptyJoinFormState)
  const prefix = useId()
  const [photoName, setPhotoName] = useState("")
  const photoInput = useRef<HTMLInputElement>(null)

  if (state.status === "submitted") {
    return (
      <div className="rounded-xl border border-border bg-card p-8">
        <h2 className="font-brand text-xl font-semibold tracking-tight">Application received</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          An admin reviews it and emails you a sign-in link when it is approved.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="grid gap-10" noValidate>
      {state.message ? (
        <p role="alert" className={cn(
          "rounded-lg border px-4 py-3 text-sm",
          state.status === "invalid" ? "border-border text-muted-foreground" : "border-destructive/40 text-destructive"
        )}>{state.message}</p>
      ) : null}

      <section className="grid gap-6">
        <div>
          <Label htmlFor={`${prefix}-email`}>
            Email<span aria-hidden="true" className="ml-1 text-muted-foreground">*</span>
          </Label>
          <p id={`${prefix}-email-hint`} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Your sign-in for club resources is created from this address.
          </p>
          <Input
            id={`${prefix}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            maxLength={254}
            defaultValue={state.email}
            aria-required="true"
            aria-invalid={Boolean(state.errors?.email) || undefined}
            aria-describedby={[`${prefix}-email-hint`, state.errors?.email ? `${prefix}-email-error` : null].filter(Boolean).join(" ")}
            className="mt-3"
          />
          <FieldError id={`${prefix}-email-error`} message={state.errors?.email} />
        </div>

        <div>
          <Label htmlFor={`${prefix}-photo`}>
            Photo<span aria-hidden="true" className="ml-1 text-muted-foreground">*</span>
          </Label>
          <p id={`${prefix}-photo-hint`} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            A picture of you, or of something you made. JPEG, PNG, or WebP, up to 5 MB.
          </p>
          <input
            ref={photoInput}
            id={`${prefix}-photo`}
            name="photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-required="true"
            aria-invalid={Boolean(state.errors?.photo) || undefined}
            aria-describedby={[`${prefix}-photo-hint`, state.errors?.photo ? `${prefix}-photo-error` : null].filter(Boolean).join(" ")}
            onChange={(event) => setPhotoName(event.target.files?.[0]?.name ?? "")}
            className="focus-ring mt-3 block w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2.5 text-sm file:mr-4 file:cursor-pointer file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
          {photoName ? <p className="mt-2 text-sm text-muted-foreground">{photoName}</p> : null}
          <FieldError id={`${prefix}-photo-error`} message={state.errors?.photo} />
        </div>
      </section>

      <Section title="About you">
        {aboutYou.map((field) => <TextControl key={field.name} field={field} state={state} prefix={prefix} />)}
      </Section>

      <Section title="What you are into">
        <fieldset>
          <legend className="text-sm font-medium">
            Pick at least one<span aria-hidden="true" className="ml-1 text-muted-foreground">*</span>
          </legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {categoryOptions.map((option) => (
              <label key={option} htmlFor={`${prefix}-category-${option}`} className="flex cursor-pointer items-center gap-3 text-sm">
                <input
                  id={`${prefix}-category-${option}`}
                  type="checkbox"
                  name="categories"
                  value={option}
                  defaultChecked={state.fields.categories.includes(option)}
                  className="size-4 rounded border-border accent-foreground"
                />
                {option}
              </label>
            ))}
          </div>
          <FieldError id={`${prefix}-categories-error`} message={state.errors?.categories} />
        </fieldset>
        <TextControl
          field={{ name: "otherCategory", label: "If you picked Other, what is it?", maxLength: profileLimits.category }}
          state={state}
          prefix={prefix}
        />
      </Section>

      <Section title="Your work">
        {yourWork.map((field) => <TextControl key={field.name} field={field} state={state} prefix={prefix} />)}
      </Section>

      <Section title="Links">
        {links.map((field) => <TextControl key={field.name} field={field} state={state} prefix={prefix} />)}
      </Section>

      {/* Spam guard. Hidden from people and from assistive technology; a filled
          value is treated as a bot and never reaches the database. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor={`${prefix}-${applicationHoneypotField}`}>Leave this empty</label>
        <input id={`${prefix}-${applicationHoneypotField}`} name={applicationHoneypotField} type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="flex items-center gap-4 border-t border-border pt-8">
        <SubmitButton />
      </div>
    </form>
  )
}
