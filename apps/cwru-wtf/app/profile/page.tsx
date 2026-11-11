import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import Wordmark from "@/components/wordmark"
import { env } from "@/env"
import { getMemberProfile } from "@/lib/member-profiles"
import { tekidMembersPath, tekidProfilePath } from "@/lib/tekid/config"
import { getDashboardAuthContext, AuthorizationError } from "@/lib/authorization"
import { TekidProfileContractError } from "@/lib/tekid/profile"
import { getTekidAuthContext } from "@/lib/tekid/server"
import { signInWithTekid, signOutFromTekid } from "./actions"
import { ApplicationForm, ProfileAvatar, ProfileForm, ProfileSubmitButton } from "./profile-controls"

export const metadata: Metadata = {
  title: "Your profile - dot*WTF",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

// This is the club's only membership form. A stranger fills it in with no
// account at all: the club account is minted when an admin approves them, so
// requiring a sign-in here would be asking for the thing this page produces.
// A member who is signed in gets the same questions, already filled in.
export default async function ProfilePage({ searchParams }: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const [auth, params] = await Promise.all([
    getTekidAuthContext().catch((error: unknown) => {
      if (error instanceof TekidProfileContractError) return error
      throw error
    }),
    searchParams,
  ])

  if (!(auth instanceof TekidProfileContractError) && auth.isAuthenticated && params.error === "sign-in") redirect(tekidProfilePath)

  const signedIn = !(auth instanceof TekidProfileContractError) && auth.isAuthenticated
  const profile = signedIn
    ? await getMemberProfile(auth.claims).catch(() => {
        console.error("Unable to load a member profile")
        return null
      })
    : null
  const errorMessage = params.error === "sign-in"
    ? "We couldn’t complete your sign-in. Please try again."
    : params.error === "sign-out"
      ? "We couldn’t complete your sign-out. Please try again."
      : null
  // The club's own identity server, whatever this deployment points at.
  const clubAccountUrl = env.TEKID_ISSUER

  return (
    <div className="flex min-h-[100svh] flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-5 px-6 py-6 sm:py-8">
        <Link href="/" aria-label="dot*WTF home" className="focus-ring inline-flex min-h-11 items-center rounded-lg font-brand text-lg font-semibold">
          <Wordmark />
        </Link>
        {signedIn || auth instanceof TekidProfileContractError ? (
          <Link href="/" className={secondaryLinkClassName}>Back home</Link>
        ) : (
          <a href={`/api/tekid/sign-in?returnTo=${tekidProfilePath}`} className={secondaryLinkClassName}>Already a member? Sign in</a>
        )}
      </header>

      <main className={`mx-auto w-full flex-1 px-6 pb-20 sm:pb-28 ${signedIn ? "max-w-[1100px] pt-6 sm:pt-10" : "max-w-[640px] pt-4 sm:pt-8"}`}>
        {auth instanceof TekidProfileContractError ? (
          <section aria-labelledby="profile-heading" className="mx-auto w-full max-w-sm py-12 text-center">
            <h1 id="profile-heading" className="font-brand text-3xl font-semibold tracking-tight">Your account needs attention</h1>
            <p role="alert" className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {auth.field === "email"
                ? "Add a valid email address to your club account, then sign in again."
                : "We couldn’t load your sign-in details. Check your club account, then sign in again."}
            </p>
            <a href={clubAccountUrl} target="_blank" rel="noopener noreferrer" className={`${secondaryLinkClassName} mt-4`}>Open your club account</a>
            <form action={signInWithTekid} className="mt-7">
              <ProfileSubmitButton pendingLabel="Taking you to sign-in…">Sign in again</ProfileSubmitButton>
            </form>
            <form action={signOutFromTekid} className="mt-3">
              <ProfileSubmitButton pendingLabel="Signing out…" variant="outline">Sign out</ProfileSubmitButton>
            </form>
            {errorMessage ? <p role="alert" className="mt-5 text-sm text-destructive">{errorMessage}</p> : null}
          </section>
        ) : auth.isAuthenticated ? (
          <div className="grid gap-10 md:grid-cols-[240px_minmax(0,1fr)] md:gap-14 lg:gap-20">
            <aside className="text-center md:sticky md:top-10 md:self-start">
              <ProfileAvatar name={profile?.fields.name || auth.claims.name || "Your profile"} picture={auth.claims.picture} />
              <h1 id="profile-heading" className="mt-5 break-words font-brand text-3xl font-semibold tracking-tight">Your profile</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">A little about you.<br />A starting point for what&apos;s next.</p>
              {profile?.memberNumber != null ? (
                <p className="mt-5 font-mono text-sm text-muted-foreground">Member #{profile.memberNumber}</p>
              ) : null}
              <nav aria-label="Your account" className="mt-5 flex flex-wrap justify-center gap-x-5 md:flex-col md:items-center md:gap-0">
                {profile?.status === "approved" ? <Link href={tekidMembersPath} className={secondaryLinkClassName}>Member directory</Link> : null}
                <Suspense fallback={null}><DashboardLink /></Suspense>
              </nav>
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Your name and application live here.<br />Your Club ID handles your sign-in.</p>
              <form action={signOutFromTekid} className="mt-6">
                <ProfileSubmitButton pendingLabel="Signing out…" variant="outline">Sign out</ProfileSubmitButton>
              </form>
              {errorMessage ? <p role="alert" className="mt-5 text-sm text-destructive">{errorMessage}</p> : null}
            </aside>

            <section aria-labelledby="profile-heading" className="min-w-0">
              {profile ? (
                <>
                  {profile.imported ? <p role="status" className="mb-6 rounded-xl border border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">We brought over the answers from your earlier application. Review them and fill in anything that is missing.</p> : null}
                  <ProfileForm
                    initialFields={profile.fields}
                    status={profile.status}
                    email={auth.claims.email}
                    emailVerified={auth.claims.email_verified}
                    memberNumber={profile.memberNumber}
                    submittedAt={profile.submittedAt}
                    clubIdAccountUrl={clubAccountUrl}
                  />
                </>
              ) : (
                <div role="alert" className="rounded-2xl border border-border p-6">
                  <p className="text-sm text-destructive">We couldn’t load your profile. Your saved details are still safe.</p>
                  <a href={tekidProfilePath} className={`${secondaryLinkClassName} mt-3`}>Try again</a>
                </div>
              )}
            </section>
          </div>
        ) : (
          <section aria-labelledby="profile-heading">
            <h1 id="profile-heading" className="font-brand text-page-title">Join dot*WTF</h1>
            <p className="mt-4 text-body leading-relaxed text-muted-foreground">
              Tell us who you are and what you make. An admin reads every application, and your club account is created when yours is approved.
            </p>
            {errorMessage ? <p role="alert" className="mt-5 text-sm text-destructive">{errorMessage}</p> : null}
            <div className="mt-10">
              <ApplicationForm allowedEmailDomains={[...env.MEMBER_EMAIL_DOMAINS]} />
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

const secondaryLinkClassName = "focus-ring inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 hover:text-muted-foreground"

async function DashboardLink() {
  const auth = await getDashboardAuthContext().catch((error: unknown) => {
    if (error instanceof AuthorizationError && error.status === 503) return null
    throw error
  })
  if (!auth?.isAuthenticated || !auth.canAccessDashboard || !auth.permissions.includes("submissions:read")) return null
  return <Link href="/admin" className={secondaryLinkClassName}>Open dashboard</Link>
}
