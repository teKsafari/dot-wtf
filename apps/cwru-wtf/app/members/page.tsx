import type { Metadata } from "next"
import type { ReactNode } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Button } from "@/components/ui/button"
import SiteFooter from "@/components/site-footer"
import SiteNav from "@/components/site-nav"
import { tekidMembersPath, tekidProfilePath } from "@/lib/tekid/config"
import { getMemberDirectory } from "@/lib/member-directory"
import { TekidProfileContractError } from "@/lib/tekid/profile"
import MemberGrid from "./member-grid"

export const metadata: Metadata = {
  title: "Members - dot WTF",
  robots: { index: false, follow: false },
}

export const dynamic = "force-dynamic"

export default async function MembersPage() {
  const directory = await getMemberDirectory().catch((error: unknown) => {
    if (error instanceof TekidProfileContractError) redirect(tekidProfilePath)
    console.error("Unable to load the member directory")
    return null
  })

  return (
    <div className="mx-auto w-full max-w-[1160px] px-6">
      <SiteNav />

      <main aria-labelledby="members-heading" className="py-14 md:py-20">
        <h1 id="members-heading" className="font-brand text-page-title text-foreground">
          Members
        </h1>

        {directory === null ? (
          <Notice description="We couldn’t load the member directory. Please try again in a moment.">
            <Button asChild><a href={tekidMembersPath}>Try again</a></Button>
          </Notice>
        ) : directory.status === "signed-out" ? (
          <Notice description="Sign in with tekID to see who’s building at dot WTF.">
            <Button asChild><a href={`/api/tekid/sign-in?returnTo=${tekidMembersPath}`}>Sign in</a></Button>
          </Notice>
        ) : directory.status === "not-member" ? (
          <Notice description="The directory opens once your application is approved. Complete your profile to apply, or check your application status there.">
            <Button asChild><Link href={tekidProfilePath}>Your profile and application</Link></Button>
          </Notice>
        ) : (
          <>
            <p className="mt-5 max-w-content text-pretty text-body text-muted-foreground md:text-lg">
              {directory.members.length === 1 ? "1 member" : `${directory.members.length} members`}.
              Select someone to see their profile.
            </p>
            <div className="mt-10">
              <MemberGrid members={directory.members} viewerId={directory.viewerId} />
            </div>
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  )
}

function Notice({ description, children }: { description: string; children: ReactNode }) {
  return (
    <>
      <p className="mt-5 max-w-content text-pretty text-body text-muted-foreground md:text-lg">
        {description}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">{children}</div>
    </>
  )
}
