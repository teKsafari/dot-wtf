"use client"

import type { ReactNode } from "react"
import { useFormStatus } from "react-dom"
import * as Avatar from "@radix-ui/react-avatar"
import { Button } from "@/components/ui/button"

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

export function ProfileAvatar({ name, picture }: { name: string; picture: string | null }) {
  const initials = name.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toUpperCase()

  return (
    <Avatar.Root className="mx-auto flex size-24 overflow-hidden rounded-full bg-muted">
      {picture ? (
        <Avatar.Image src={picture} alt={`${name}’s profile picture`} referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : null}
      <Avatar.Fallback className="flex size-full items-center justify-center font-brand text-2xl font-semibold text-muted-foreground" aria-label={`${name}’s profile picture`}>
        {initials}
      </Avatar.Fallback>
    </Avatar.Root>
  )
}
