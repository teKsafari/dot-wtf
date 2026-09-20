import type { Metadata } from "next"
import Link from "next/link"
import Wordmark from "@/components/wordmark"
import { getTekidProfile } from "@/lib/tekid/server"
import { signInWithTekid, signOutFromTekid } from "./actions"
import { ProfileAvatar, ProfileSubmitButton } from "./profile-controls"

export const metadata: Metadata = {
  title: "Your profile - CWRU.WTF",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function TestProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const [profile, params] = await Promise.all([getTekidProfile(), searchParams])
  const errorMessage =
    params.error === "sign-in"
      ? "We couldn’t complete your sign-in. Please try again."
      : params.error === "sign-out"
        ? "We couldn’t complete your sign-out. Please try again."
        : null

  return (
    <div className="flex min-h-[100svh] flex-col bg-background text-foreground">
      <header className="px-6 py-6 sm:px-10">
        <Link href="/" className="focus-ring inline-flex min-h-11 items-center rounded-lg font-brand text-lg font-semibold">
          <Wordmark />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-24">
        <section aria-labelledby="profile-heading" className="w-full max-w-sm text-center">
          {profile ? (
            <>
              <ProfileAvatar name={profile.name} picture={profile.picture} />
              <h1 id="profile-heading" className="mt-5 break-words font-brand text-3xl font-semibold tracking-tight">
                {profile.name}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">Your dot wtf profile</p>
              <form action={signOutFromTekid} className="mt-7">
                <ProfileSubmitButton pendingLabel="Signing out…" variant="outline">
                  Sign out
                </ProfileSubmitButton>
              </form>
            </>
          ) : (
            <>
              <h1 id="profile-heading" className="font-brand text-3xl font-semibold tracking-tight">
                Your dot wtf profile
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                Sign in or create an account with{" "}
                <a
                  href="https://www.teksafari.org/solutions/tekid"
                  className="focus-ring rounded-sm underline underline-offset-4 hover:text-foreground"
                >
                  tekID
                </a>
                .
              </p>
              <form action={signInWithTekid} className="mt-7">
                <ProfileSubmitButton pendingLabel="Continuing to tekID…">
                  Continue to dot wtf profile
                </ProfileSubmitButton>
              </form>
            </>
          )}
          {errorMessage ? (
            <p role="alert" className="mt-5 text-sm text-destructive">{errorMessage}</p>
          ) : null}
        </section>
      </main>
    </div>
  )
}
