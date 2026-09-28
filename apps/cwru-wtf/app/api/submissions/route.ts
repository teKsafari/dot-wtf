import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    {
      error: "Applications have moved. Sign in and complete your member profile.",
      applicationUrl: "/profile",
    },
    { status: 410 },
  )
}
