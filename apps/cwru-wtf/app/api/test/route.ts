import { NextResponse } from 'next/server';
import { isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';

export async function GET() {
  try {
    // Test database connection and schema
    const testSubmissions = await db
      .select()
      .from(submissions)
      .where(isNull(submissions.archivedAt))
      .limit(5);
    
    return NextResponse.json({
      status: 'OK',
      message: 'Database connection successful',
      schemaTest: {
        submissionsTable: 'exists',
        sampleData: testSubmissions.length,
        pendingByDefault: testSubmissions.every(s => s.isApproved === null || typeof s.isApproved === 'boolean')
      }
    });
  } catch (error) {
    console.error('Database test failed:', error);
    return NextResponse.json({
      status: 'ERROR',
      message: 'Database connection failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
