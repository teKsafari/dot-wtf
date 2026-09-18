import { redirect } from 'next/navigation';
import { desc } from 'drizzle-orm';
import AdminDashboard, {
  type AdminSubmission,
} from '@/components/admin/admin-dashboard';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';

export default async function AdminPage() {
  const session = await auth();

  if (
    !session?.user ||
    (session.user.role !== 'admin' && session.user.role !== 'super_admin')
  ) {
    redirect('/login');
  }

  const initialSubmissions = await db
    .select()
    .from(submissions)
    .orderBy(desc(submissions.createdAt));

  const serializedSubmissions: AdminSubmission[] = initialSubmissions.map(
    (submission) => ({
      ...submission,
      archivedAt: submission.archivedAt?.toISOString() ?? null,
      createdAt: submission.createdAt.toISOString(),
      updatedAt: submission.updatedAt.toISOString(),
    })
  );

  return (
    <AdminDashboard
      admin={{
        email: session.user.email ?? '',
        name: session.user.name ?? 'Admin',
        role: session.user.role ?? 'admin',
      }}
      initialSubmissions={serializedSubmissions}
    />
  );
}
