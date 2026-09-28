"use client"

import { useActionState, useId, type ReactNode } from "react"
import { useFormStatus } from "react-dom"
import * as Avatar from "@radix-ui/react-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  profileLimits,
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

const fields: {
  name: ProfileField
  label: string
  hint: string
  multiline: boolean
  maxLength: number
}[] = [
  { name: "bio", label: "Bio", hint: "Members see this with your name and photo.", multiline: true, maxLength: profileLimits.bio },
  { name: "wtfIdea", label: "Your WTF idea", hint: "What do you want to build that would make people go WTF?", multiline: true, maxLength: profileLimits.text },
  { name: "currentProject", label: "Current project", hint: "What have you built, or what are you building now?", multiline: true, maxLength: profileLimits.text },
  { name: "youtubeLink", label: "Video", hint: "A YouTube link to something that interests you.", multiline: false, maxLength: profileLimits.link },
]

export function ProfileForm({ initialFields }: { initialFields: ProfileFields }) {
  const [state, formAction, pending] = useActionState(saveProfile, {
    status: "idle",
    fields: initialFields,
  } satisfies ProfileFormState)
  const id = useId()

  return (
    <form action={formAction} className="flex flex-col gap-6 text-left" noValidate>
      {fields.map((field, index) => {
        const error = state.errors?.[field.name]
        const inputId = `${id}-${field.name}`
        const hintId = `${inputId}-hint`
        const errorId = `${inputId}-error`
        const common = {
          id: inputId,
          name: field.name,
          // React resets the form after each submission; the state keeps what was entered.
          defaultValue: state.fields[field.name],
          maxLength: field.maxLength,
          invalid: Boolean(error),
          "aria-describedby": error ? `${hintId} ${errorId}` : hintId,
        }

        return (
          <div key={field.name} className={cn(index === 1 && "border-t border-border pt-6")}>
            {index === 1 ? (
              <p className="mb-6 text-sm text-muted-foreground">
                Only you can see the rest of your profile.
              </p>
            ) : null}
            <Label htmlFor={inputId}>{field.label}</Label>
            <p id={hintId} className="mt-1.5 text-sm text-muted-foreground">{field.hint}</p>
            {field.multiline ? (
              <Textarea {...common} rows={field.name === "bio" ? 3 : 4} className="mt-3" />
            ) : (
              <Input {...common} type="url" inputMode="url" placeholder="https://youtube.com/watch?v=…" className="mt-3" />
            )}
            {error ? (
              <p id={errorId} className="mt-2 text-sm text-destructive">{error}</p>
            ) : null}
          </div>
        )
      })}

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
