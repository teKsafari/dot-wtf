import type { Metadata } from "next"
import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import Wordmark from "@/components/wordmark"
import { getMemberProfile } from "@/lib/member-profiles"
import { tekidMembersPath, tekidProfilePath } from "@/lib/tekid/config"
import { getDashboardAuthContext, TekidAuthorizationError } from "@/lib/tekid/authorization"
import { TekidProfileContractError } from "@/lib/tekid/profile"
import { getTekidAuthContext } from "@/lib/tekid/server"
import { signInWithTekid, signOutFromTekid } from "./actions"
import { ProfileAvatar, ProfileForm, ProfileSubmitButton } from "./profile-controls"

export const metadata: Metadata = {
  title: "Your profile - CWRU.WTF",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const [auth, params] = await Promise.all([
    getTekidAuthContext().catch((error: unknown) => {
      // Older sessions need a new sign-in after adding the required email scope.
      // An incomplete profile is distinct from a signed-out session.
      if (error instanceof TekidProfileContractError) return error
      throw error
    }),
    searchParams,
  ])

  // A retried callback can leave an error flag after a session was established.
  if (!(auth instanceof TekidProfileContractError) && auth.isAuthenticated && params.error === "sign-in") {
    redirect(tekidProfilePath)
  }

  const signedIn = !(auth instanceof TekidProfileContractError) && auth.isAuthenticated
  const profile = signedIn
    ? await getMemberProfile(auth.claims).catch(() => {
        console.error("Unable to load a member profile")
        return null
      })
    : null

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
        <section aria-labelledby="profile-heading" className={`w-full text-center ${signedIn ? "max-w-xl" : "max-w-sm"}`}>
          {auth instanceof TekidProfileContractError ? (
            <>
              <h1 id="profile-heading" className="font-brand text-3xl font-semibold tracking-tight">
                Your profile needs attention
              </h1>
              <p role="alert" className="mt-3 text-sm text-muted-foreground">
                {auth.field === "name" || auth.field === "email"
                  ? `Check that your tekID profile has a ${auth.field === "email" ? "valid email address" : "display name"}, then sign in again.`
                  : "We couldn’t load the required profile details from tekID. Check your profile, then sign in again."}
              </p>
              <a
                href={auth.field === "name"
                  ? "https://id.teksafari.org/account/profile"
                  : "https://id.teksafari.org/account/security"}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring mt-4 inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 hover:text-muted-foreground"
              >
                Open tekID account
              </a>
              <form action={signInWithTekid} className="mt-7">
                <ProfileSubmitButton pendingLabel="Continuing to tekID…">
                  Sign in again
                </ProfileSubmitButton>
              </form>
              <form action={signOutFromTekid} className="mt-3">
                <ProfileSubmitButton pendingLabel="Signing out…" variant="outline">
                  Sign out
                </ProfileSubmitButton>
              </form>
            </>
          ) : auth.isAuthenticated ? (
            <>
              <ProfileAvatar name={auth.claims.name} picture={auth.claims.picture} />
              <h1 id="profile-heading" className="mt-5 break-words font-brand text-3xl font-semibold tracking-tight">
                {auth.claims.name}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">Your dot wtf profile</p>
              <div className="mt-4 flex flex-wrap justify-center gap-x-6">
                <a
                  href="https://id.teksafari.org/account/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={secondaryLinkClassName}
                >
                  Edit name or photo in tekID
                </a>
                <Link href={tekidMembersPath} className={secondaryLinkClassName}>
                  Members
                </Link>
                <Suspense fallback={null}>
                  <DashboardLink />
                </Suspense>
              </div>
              <div className="mt-10">
                {profile ? (
                  <>
                    {profile.imported ? (
                      <p role="status" className="mb-8 rounded-xl bg-muted px-4 py-3 text-left text-sm text-muted-foreground">
                        We filled in your WTF idea, project, and video from your cwru.wtf application.
                      </p>
                    ) : null}
                    <ProfileForm initialFields={profile.fields} />
                  </>
                ) : (
                  <p role="alert" className="text-sm text-destructive">
                    We couldn’t load your profile details. Please try again in a moment.
                  </p>
                )}
              </div>
              <form action={signOutFromTekid} className="mt-12">
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

const secondaryLinkClassName =
  "focus-ring inline-flex min-h-11 items-center rounded-sm text-sm underline underline-offset-4 hover:text-muted-foreground"

async function DashboardLink() {
  const auth = await getDashboardAuthContext().catch((error: unknown) => {
    if (error instanceof TekidAuthorizationError && error.status === 503) return null
    throw error
  })

  if (
    !auth?.isAuthenticated ||
    !auth.canAccessDashboard ||
    (auth.role !== "admin" && auth.role !== "instance-lead") ||
    !auth.permissions.includes("submissions:read")
  ) return null

  return (
    <Link href="/admin" className={secondaryLinkClassName}>
      Open dashboard
    </Link>
  )
}
