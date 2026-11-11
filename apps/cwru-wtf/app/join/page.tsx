import type { Metadata } from "next"
import Link from "next/link"

import Wordmark from "@/components/wordmark"
import JoinForm from "./join-form"

export const metadata: Metadata = {
  title: "Join dot*WTF",
  description: "Apply for dot*WTF membership.",
}

// Anyone can open this page. An applicant has no account yet: the tekID sign-in
// that reaches club resources is created when an admin approves the application.
export const dynamic = "force-dynamic"

export default function JoinPage() {
  return (
    <div className="flex min-h-[100svh] flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-5 px-6 py-6 sm:py-8">
        <Link href="/" aria-label="dot*WTF home" className="focus-ring inline-flex min-h-11 items-center rounded-lg font-brand text-lg font-semibold">
          <Wordmark />
        </Link>
        <Link href="/profile" className="focus-ring inline-flex min-h-11 items-center rounded-lg text-sm text-muted-foreground underline-offset-4 hover:underline">
          Already a member?
        </Link>
      </header>

      <main className="mx-auto w-full max-w-[640px] flex-1 px-6 pb-20 pt-4 sm:pb-28 sm:pt-8">
        <h1 className="font-brand text-3xl font-semibold tracking-tight sm:text-4xl">Join dot*WTF</h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Tell us who you are and what you make. An admin reads every application.
        </p>
        <div className="mt-10">
          <JoinForm />
        </div>
      </main>
    </div>
  )
}
