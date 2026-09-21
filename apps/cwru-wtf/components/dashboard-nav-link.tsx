"use client"

import Link from "next/link"
import { LayoutDashboard } from "lucide-react"
import useSWR from "swr"

async function fetchAccess(url: string): Promise<{ allowed: boolean }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Dashboard access check failed (${response.status})`)
  return response.json()
}

export default function DashboardNavLink({
  initialAllowed,
  className,
}: {
  initialAllowed: boolean | null
  className: string
}) {
  const { data, error } = useSWR("/api/tekid/dashboard-access", fetchAccess, {
    fallbackData: initialAllowed === null ? undefined : { allowed: initialAllowed },
  })

  if (!data) {
    if (error) return null
    // No verified hint yet: hold the slot so the neighbouring icons stay still.
    return (
      <li aria-hidden="true" className="inline-flex">
        <span className="-my-2 inline-flex size-10" />
      </li>
    )
  }

  if (!data.allowed) return null

  return (
    <li className="inline-flex">
      <Link href="/admin" aria-label="Dashboard" title="Dashboard" className={className}>
        <LayoutDashboard aria-hidden="true" className="h-4 w-4" />
      </Link>
    </li>
  )
}
