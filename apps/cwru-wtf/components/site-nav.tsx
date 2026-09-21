import { Suspense } from "react"
import Link from "next/link"
import { Calendar, Github, Instagram, LayoutDashboard, UserRound } from "lucide-react"
import { getDashboardAuthContext, TekidAuthorizationError } from "@/lib/tekid/authorization"
import { TekidProfileContractError } from "@/lib/tekid/profile"

const socialLinks = [
  {
    href: "https://github.com/teksafari/dot-wtf",
    label: "CWRU.WTF on GitHub",
    icon: Github,
  },
  {
    href: "https://instagram.com/cwru.wtf",
    label: "CWRU.WTF on Instagram",
    icon: Instagram,
  },
]

// Keep the chrome compact while preserving the buttons' 40px hit target.
// The interaction follows the buttons: quiet colour feedback and a 1px press.
const linkClassName =
  "focus-ring -my-2 inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-[color,transform] duration-150 hover:text-foreground active:translate-y-px motion-reduce:transition-none"

function Separator() {
  return <li aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
}

async function DashboardNavItem() {
  const auth = await getDashboardAuthContext().catch((error: unknown) => {
    if (error instanceof TekidProfileContractError) return null
    if (error instanceof TekidAuthorizationError && error.status === 503) return null
    throw error
  })

  if (
    !auth?.isAuthenticated ||
    !auth.canAccessDashboard ||
    !auth.role ||
    !auth.permissions.includes("submissions:read")
  ) return null

  return (
    <li className="inline-flex">
      <Link href="/admin" aria-label="Dashboard" title="Dashboard" className={linkClassName}>
        <LayoutDashboard aria-hidden="true" className="h-4 w-4" />
      </Link>
    </li>
  )
}

export default function SiteNav() {
  return (
    <nav
      aria-label="Primary navigation"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2"
    >
      <ul className="m-0 flex w-fit list-none items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-4 py-2">
        <li className="inline-flex">
          <Link href="/calendar" aria-label="Calendar" className={linkClassName}>
            <Calendar aria-hidden="true" className="h-4 w-4" />
          </Link>
        </li>

        <li className="inline-flex">
          <Link href="/profile" aria-label="Profile" title="Profile" className={linkClassName}>
            <UserRound aria-hidden="true" className="h-4 w-4" />
          </Link>
        </li>

        <Suspense fallback={null}>
          <DashboardNavItem />
        </Suspense>

        <Separator />

        {socialLinks.map(({ href, label, icon: Icon }) => (
          <li key={href} className="inline-flex">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className={linkClassName}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
