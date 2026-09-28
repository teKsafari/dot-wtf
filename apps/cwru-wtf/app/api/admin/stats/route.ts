import { NextResponse } from 'next/server';
import {
  requireDashboardPermission,
  AuthorizationError,
} from '@/lib/authorization';
import { getSubmissionStats } from '@/lib/submissions';

export async function GET() {
  try {
    await requireDashboardPermission('submissions:read');

    const stats = await getSubmissionStats();
    return NextResponse.json(stats, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching stats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
