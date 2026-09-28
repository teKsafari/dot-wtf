"use client"

import { useActionState, useEffect, useId, useRef, type ReactNode } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import * as Avatar from "@radix-ui/react-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  profileFieldsFromFormData,
  profileLimits,
  socialLinkLabels,
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

const avatarSizes = {
  sm: "size-12 text-base",
  lg: "mx-auto size-24 text-2xl",
}

export function ProfileAvatar({ name, picture, size = "lg" }: {
  name: string
  picture: string | null
  size?: keyof typeof avatarSizes
}) {
  const initials = name.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase()

  return (
    <Avatar.Root className={cn("flex shrink-0 overflow-hidden rounded-full bg-muted font-brand font-semibold", avatarSizes[size])}>
      {picture ? (
        <Avatar.Image src={picture} alt={`${name}’s profile picture`} referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : null}
      <Avatar.Fallback className="flex size-full items-center justify-center text-muted-foreground" aria-label={`${name}’s profile picture`}>
        {initials}
      </Avatar.Fallback>
    </Avatar.Root>
  )
}

interface FieldConfig {
  name: ProfileField
  label: string
  hint?: string
  maxLength: number
  rows?: number
  placeholder?: string
  type?: "text" | "url"
}

const bioField: FieldConfig = {
  name: "bio", label: "Bio", hint: "Members see this with your name and photo.", maxLength: profileLimits.bio, rows: 3,
}

const linkFields: FieldConfig[] = [
  { name: "github", label: socialLinkLabels.github, placeholder: "username", maxLength: profileLimits.social },
  { name: "instagram", label: socialLinkLabels.instagram, placeholder: "@username", maxLength: profileLimits.social },
  { name: "linkedin", label: socialLinkLabels.linkedin, placeholder: "linkedin.com/in/you", maxLength: profileLimits.social },
  { name: "portfolio", label: socialLinkLabels.portfolio, placeholder: "yoursite.com", maxLength: profileLimits.link },
]

const privateFields: FieldConfig[] = [
  { name: "wtfIdea", label: "Your WTF idea", hint: "What do you want to build that would make people go WTF?", maxLength: profileLimits.text, rows: 4 },
  { name: "currentProject", label: "Current project", hint: "What have you built, or what are you building now?", maxLength: profileLimits.text, rows: 4 },
  { name: "youtubeLink", label: "Video", hint: "A YouTube link to something that interests you.", maxLength: profileLimits.link, type: "url", placeholder: "https://youtube.com/watch?v=…" },
]

function ProfileInput({ field, state, idPrefix }: {
  field: FieldConfig
  state: ProfileFormState
  idPrefix: string
}) {
  const error = state.errors?.[field.name]
  const inputId = `${idPrefix}-${field.name}`
  const hintId = field.hint ? `${inputId}-hint` : null
  const errorId = `${inputId}-error`
  const common = {
    id: inputId,
    name: field.name,
    // React resets the form after each submission; the state keeps what was entered.
    defaultValue: state.fields[field.name],
    maxLength: field.maxLength,
    invalid: Boolean(error),
    "aria-describedby": [hintId, error ? errorId : null].filter(Boolean).join(" ") || undefined,
  }

  return (
    <div>
      <Label htmlFor={inputId}>{field.label}</Label>
      {hintId ? <p id={hintId} className="mt-1.5 text-sm text-muted-foreground">{field.hint}</p> : null}
      {field.rows ? (
        <Textarea {...common} rows={field.rows} className="mt-3" />
      ) : (
        <Input
          {...common}
          type={field.type ?? "text"}
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder={field.placeholder}
          className="mt-3"
        />
      )}
      {error ? <p id={errorId} className="mt-2 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

// A dropped connection or a deploy mid-save rejects the action; keep the text instead of crashing.
async function saveProfileOrKeepInput(previous: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  try {
    return await saveProfile(previous, formData)
  } catch {
    return {
      status: "error",
      fields: profileFieldsFromFormData(formData),
      message: "We couldn’t reach cwru.wtf. Check your connection, then save again.",
    }
  }
}

export function ProfileForm({ initialFields }: { initialFields: ProfileFields }) {
  const [state, formAction, pending] = useActionState(saveProfileOrKeepInput, {
    status: "idle",
    fields: initialFields,
  } satisfies ProfileFormState)
  const id = useId()
  const router = useRouter()
  const focusedOnSubmit = useRef<HTMLElement | null>(null)

  // Refresh after the save settles, not inside the action, so the form unlocks right away.
  // A refresh also clears cached pages, so Back cannot restore (and re-save) the old profile.
  useEffect(() => {
    if (state.status === "saved") router.refresh()
  }, [state, router])

  // Locking the fields drops focus to <body>; return it once they unlock.
  useEffect(() => {
    if (pending) return
    const element = focusedOnSubmit.current
    focusedOnSubmit.current = null
    if (element?.isConnected && (document.activeElement === document.body || !document.activeElement)) {
      element.focus()
    }
  }, [pending])

  return (
    <form
      action={formAction}
      onSubmit={() => {
        focusedOnSubmit.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }}
      className="flex flex-col gap-6 text-left"
      noValidate
    >
      {/* React resets the form when the save settles, so nothing can be typed until then. */}
      <fieldset disabled={pending} className="flex min-w-0 flex-col gap-6">
        <ProfileInput field={bioField} state={state} idPrefix={id} />

        <fieldset className="min-w-0" aria-describedby={`${id}-links-hint`}>
          <legend className="block font-mono text-xs uppercase tracking-widest text-muted-foreground">Links</legend>
          <p id={`${id}-links-hint`} className="mt-1.5 text-sm text-muted-foreground">
            Members see these next to your bio. A username or a full link both work.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {linkFields.map((field) => (
              <ProfileInput key={field.name} field={field} state={state} idPrefix={id} />
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-6 border-t border-border pt-6">
          <p className="text-sm text-muted-foreground">Only you can see the rest of your profile.</p>
          {privateFields.map((field) => (
            <ProfileInput key={field.name} field={field} state={state} idPrefix={id} />
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
        <p
          aria-live="polite"
          className={cn("text-sm", state.status === "saved" ? "text-success" : "text-destructive")}
        >
          {pending ? null : state.message}
        </p>
      </div>
    </form>
  )
}
