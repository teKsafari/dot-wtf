import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    {
      error: "Applications have moved. Please use the current application form.",
      applicationUrl: "https://tally.so/r/lbp7OX",
    },
    { status: 410 },
  )
}
