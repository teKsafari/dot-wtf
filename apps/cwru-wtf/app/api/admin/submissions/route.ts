import { NextResponse } from 'next/server';
import { desc } from 'drizzle-orm';
import { requireDashboardPermission, AuthorizationError } from '@/lib/authorization';
import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';

export async function GET() {
  try {
    await requireDashboardPermission('submissions:read');

    const allSubmissions = await db
      .select()
      .from(submissions)
      .orderBy(desc(submissions.createdAt));

    return NextResponse.json(allSubmissions, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching submissions:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH() {
  try {
    await requireDashboardPermission('submissions:read');
    return NextResponse.json({ error: 'Historical applications are read-only. Review current member profiles instead.' }, { status: 410 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Membership permissions are temporarily unavailable.' }, { status: 503 });
  }
}
