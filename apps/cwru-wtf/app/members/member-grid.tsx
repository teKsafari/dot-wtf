"use client"

import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { Github, Globe, Instagram, Linkedin, X } from "lucide-react"
import { ProfileAvatar } from "@/app/profile/profile-controls"
import { socialLinkLabels, socialPlatforms } from "@/lib/member-profile-fields"
import type { DirectoryMember } from "@/lib/tekid/member-types"

const unnamed = "Unnamed member"

const socialIcons = { github: Github, instagram: Instagram, linkedin: Linkedin, portfolio: Globe }

export default function MemberGrid({ members, viewerId }: {
  members: DirectoryMember[]
  viewerId: string
}) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => (
        <li key={member.id}>
          <MemberCard member={member} isViewer={member.id === viewerId} />
        </li>
      ))}
    </ul>
  )
}

function MemberCard({ member, isViewer }: { member: DirectoryMember; isViewer: boolean }) {
  const name = member.name ?? unnamed

  return (
    <Dialog.Root>
      <Dialog.Trigger className="focus-ring corner-squircle flex h-full w-full items-start gap-4 rounded-2xl border border-edge bg-card p-5 text-left transition-[border-color,transform] duration-150 hover:border-muted-foreground/35 active:scale-[0.98] motion-reduce:transition-none">
        <ProfileAvatar name={name} picture={member.picture} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-brand font-semibold text-foreground">{name}</span>
            {isViewer ? <YouBadge /> : null}
          </span>
          <span className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {member.bio || "No bio yet."}
          </span>
        </span>
      </Dialog.Trigger>

      <Dialog.Portal>
        {/* The overlay centres and scrolls the card, so the card's own
            transform is free for the scale-in. */}
        <Dialog.Overlay className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/40 p-4 duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
          <Dialog.Content className="corner-squircle relative w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-xl duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <Dialog.Close
              aria-label="Close"
              className="focus-ring absolute right-3 top-3 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            >
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
            <ProfileAvatar name={name} picture={member.picture} />
            <Dialog.Title className="mt-5 break-words font-brand text-2xl font-semibold tracking-tight">
              {name}
            </Dialog.Title>
            {isViewer ? <div className="mt-2"><YouBadge /></div> : null}
            <Dialog.Description className="mt-4 whitespace-pre-line break-words text-left text-body text-muted-foreground">
              {member.bio || `${name} hasn’t written a bio yet.`}
            </Dialog.Description>
            <MemberLinks member={member} name={name} />
            {isViewer ? (
              <Link
                href="/profile"
                className="focus-ring mt-6 inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 hover:text-muted-foreground"
              >
                Edit your profile
              </Link>
            ) : null}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function MemberLinks({ member, name }: { member: DirectoryMember; name: string }) {
  const platforms = socialPlatforms.filter((platform) => member.links[platform])
  if (platforms.length === 0) return null

  return (
    <ul aria-label={`${name}’s links`} className="m-0 mt-6 flex list-none flex-wrap gap-2 p-0">
      {platforms.map((platform) => {
        const Icon = socialIcons[platform]
        return (
          <li key={platform}>
            <a
              href={member.links[platform]}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring corner-squircle inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm text-foreground transition-[background-color,border-color] duration-150 hover:border-muted-foreground/35 hover:bg-secondary motion-reduce:transition-none"
            >
              <Icon aria-hidden="true" className="size-4" />
              {socialLinkLabels[platform]}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function YouBadge() {
  return (
    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
      You
    </span>
  )
}
