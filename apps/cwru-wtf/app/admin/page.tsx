import { redirect } from 'next/navigation';
import Link from 'next/link';
import { desc } from 'drizzle-orm';
import AdminDashboard, {
  type AdminSubmission,
} from '@/components/admin/admin-dashboard';
import {
  getDashboardAuthContext,
  TekidAuthorizationError,
} from '@/lib/tekid/authorization';
import { Button } from '@/components/ui/button';
import { TekidProfileContractError } from '@/lib/tekid/profile';
import { db } from '@/lib/db';
import { submissions } from '@/lib/schema';

export default async function AdminPage() {
  const auth = await getDashboardAuthContext().catch((error: unknown) => {
    if (error instanceof TekidProfileContractError) {
      redirect('/profile');
    }
    if (error instanceof TekidAuthorizationError && error.status === 503) {
      return error;
    }
    throw error;
  });

  if (auth instanceof TekidAuthorizationError) {
    return (
      <AdminAccessMessage
        title="Admin access is temporarily unavailable"
        description="We couldn’t check your permissions. Please try again in a moment."
        retry
      />
    );
  }

  if (!auth.isAuthenticated) {
    redirect('/api/tekid/sign-in?returnTo=/admin');
  }

  if (!auth.canAccessDashboard || !auth.role || !auth.permissions.includes('submissions:read')) {
    return (
      <AdminAccessMessage
        title="Dashboard access is required"
        description="You’re signed in to tekID. Ask a CWRU.WTF admin to grant you access to this dashboard."
      />
    );
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
        email: auth.claims.email,
        name: auth.claims.name,
        role: auth.role,
        canManageSubmissions: auth.permissions.includes('submissions:manage'),
        canReadMembers: auth.permissions.includes('members:read'),
        canAddMembers: auth.permissions.includes('members:invite'),
        canAssignRoles: auth.role === 'admin' && auth.permissions.includes('members:assign-roles'),
      }}
      initialSubmissions={serializedSubmissions}
    />
  );
}

function AdminAccessMessage({ title, description, retry = false }: {
  title: string;
  description: string;
  retry?: boolean;
}) {
  return (
    <main className="flex min-h-[100svh] items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {retry ? <Button asChild><a href="/admin">Try again</a></Button> : null}
          <Button asChild variant="outline"><Link href="/profile">Go to your profile</Link></Button>
          <Button asChild variant="ghost"><Link href="/">Back to home</Link></Button>
        </div>
      </div>
    </main>
  );
}
