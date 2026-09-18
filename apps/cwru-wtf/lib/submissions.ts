import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';
import { and, count, eq, isNotNull, isNull } from 'drizzle-orm';

export async function getSubmissionStats() {
  try {
    const [
      [totalResult],
      [approvedResult],
      [pendingResult],
      [waitlistResult],
      [archivedResult],
    ] = await Promise.all([
      db
        .select({ count: count() })
        .from(submissions)
        .where(isNull(submissions.archivedAt)),
      db
        .select({ count: count() })
        .from(submissions)
        .where(
          and(
            isNull(submissions.archivedAt),
            eq(submissions.isApproved, true)
          )
        ),
      db
        .select({ count: count() })
        .from(submissions)
        .where(
          and(
            isNull(submissions.archivedAt),
            isNull(submissions.isApproved)
          )
        ),
      db
        .select({ count: count() })
        .from(submissions)
        .where(
          and(
            isNull(submissions.archivedAt),
            eq(submissions.isApproved, false)
          )
        ),
      db
        .select({ count: count() })
        .from(submissions)
        .where(isNotNull(submissions.archivedAt)),
    ]);

    return {
      total: totalResult.count,
      approved: approvedResult.count,
      pending: pendingResult.count,
      waitlist: waitlistResult.count,
      archived: archivedResult.count,
    };
  } catch (error) {
    console.error('Error fetching submission stats:', error);
    return {
      total: 0,
      approved: 0,
      pending: 0,
      waitlist: 0,
      archived: 0,
    };
  }
}
