import type { Metadata } from "next"
import TallyApplicationForm from "@/components/tally-application-form"
import SiteFooter from "@/components/site-footer"
import SiteNav from "@/components/site-nav"

export const metadata: Metadata = {
  title: "Join - CWRU.WTF",
  description: "Apply to join CWRU.WTF.",
}

export default function JoinPage() {
  return (
    <div className="mx-auto w-full max-w-[1160px] px-6">
      <SiteNav />

      <main aria-label="Join CWRU.WTF" className="pb-20 md:pb-28">
        <TallyApplicationForm />
      </main>

      <SiteFooter />
    </div>
  )
}
