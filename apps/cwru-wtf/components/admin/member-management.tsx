"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, RefreshCw, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  DashboardMember as Member,
  DashboardMembersPage as MembersPage,
  MemberRole,
} from "@/lib/tekid/member-types";

const roleLabels: Record<MemberRole, string> = {
  member: "Member",
  "instance-lead": "Instance lead",
  admin: "Admin",
};

const selectClassName = "focus-ring h-11 rounded-md border border-border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50";

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.error === "string" ? body.error : fallback);
}

export default function MemberManagement({ canAssignRoles, canAddMembers }: {
  canAssignRoles: boolean;
  canAddMembers: boolean;
}) {
  const [data, setData] = useState<MembersPage | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const mutationInFlight = useRef(false);
  const isAdding = pendingMemberId === "new-member";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    async function loadMembers() {
      try {
        const response = await fetch(`/api/admin/members?page=${page}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw await responseError(response, "Could not load members. Please try again.");
        const result = await response.json() as MembersPage;
        if (!controller.signal.aborted) setData(result);
      } catch (error) {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "Could not load members. Please try again.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadMembers();
    return () => controller.abort();
  }, [page, revision]);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPendingMemberId("new-member");
    setFormError(null);

    try {
      const response = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role: canAssignRoles ? role : "member" }),
      });
      if (!response.ok) throw await responseError(response, "Could not add this member. Please try again.");
      setEmail("");
      setRole("member");
      setPage(1);
      setRevision((current) => current + 1);
      toast.success("Member added to CWRU.WTF.", { position: "top-center" });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Could not add this member. Please try again.");
    } finally {
      mutationInFlight.current = false;
      setPendingMemberId(null);
    }
  }

  async function updateRole(memberId: string, nextRole: MemberRole) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPendingMemberId(memberId);

    try {
      const response = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!response.ok) throw await responseError(response, "Could not update this role. Please try again.");
      const { member } = await response.json() as { member: Member };
      setData((current) => current ? {
        ...current,
        members: current.members.map((entry) => entry.id === member.id ? member : entry),
      } : current);
      toast.success("Member role updated.", { position: "top-center" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update this role. Please try again.", { position: "top-center" });
    } finally {
      mutationInFlight.current = false;
      setPendingMemberId(null);
    }
  }

  return (
    <section aria-labelledby="members-heading" className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6 lg:px-0">
      <div className="flex min-h-[72px] items-center justify-between gap-4">
        <h1 id="members-heading" className="text-xl font-semibold tracking-tight">Members</h1>
        <Button
          onClick={() => setRevision((current) => current + 1)}
          variant="ghost"
          disabled={loading || pendingMemberId !== null}
          className="h-11 rounded-md px-3 text-xs"
        >
          <RefreshCw aria-hidden="true" className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {canAddMembers ? <form onSubmit={addMember} className="rounded-lg border border-border p-4 sm:p-5">
        <h2 className="text-sm font-medium">Add a member</h2>
        <p id="member-email-help" className="mt-1 text-sm text-muted-foreground">
          Use the email address on their existing tekID account to add them to CWRU.WTF.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="new-member-email" className="mb-1.5 block text-xs font-medium">Email address</label>
            <Input
              id="new-member-email"
              name="email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={pendingMemberId !== null}
              aria-describedby="member-email-help"
              className="h-11 rounded-md"
              placeholder="member@example.com"
            />
          </div>
          {canAssignRoles ? (
            <div>
              <label htmlFor="new-member-role" className="mb-1.5 block text-xs font-medium">Role</label>
              <RoleSelect id="new-member-role" value={role} onChange={setRole} disabled={pendingMemberId !== null} />
            </div>
          ) : null}
          <Button type="submit" disabled={pendingMemberId !== null} className="h-11 rounded-md">
            {isAdding ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <UserPlus aria-hidden="true" />}
            {isAdding ? "Adding…" : "Add member"}
          </Button>
        </div>
        {formError ? <p role="alert" className="mt-3 text-sm text-destructive">{formError}</p> : null}
      </form> : null}

      <p className="mt-5 text-xs leading-5 text-muted-foreground">
        Members use the site. Instance leads manage applications and add members. Admins also assign dashboard roles.
      </p>

      {loadError ? (
        <div role="alert" className="mt-5 rounded-lg border border-border p-5">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button variant="outline" onClick={() => setRevision((current) => current + 1)} className="mt-3 rounded-md">Try again</Button>
        </div>
      ) : loading && !data ? (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading members…</p>
      ) : data ? (
        <div aria-busy={loading} className={cn("mt-4", loading && "opacity-60")}>
          {data.members.length === 0 ? (
            <p className="rounded-lg border border-border px-5 py-12 text-center text-sm text-muted-foreground">
              No members on this page. Add someone using their tekID email address.
            </p>
          ) : (
            <ul aria-label="CWRU.WTF members" className="divide-y divide-border border-y border-border">
              {data.members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  canAssignRoles={canAssignRoles}
                  disabled={pendingMemberId !== null || loading}
                  saving={pendingMemberId === member.id}
                  onSave={updateRole}
                />
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs tabular-nums text-muted-foreground">Page {data.page}</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" disabled={page === 1 || loading || pendingMemberId !== null} onClick={() => setPage((current) => current - 1)} className="h-11 rounded-md">
                <ChevronLeft aria-hidden="true" /> Previous
              </Button>
              <Button variant="outline" disabled={!data.hasMore || loading || pendingMemberId !== null} onClick={() => setPage((current) => current + 1)} className="h-11 rounded-md">
                Next <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MemberRow({ member, canAssignRoles, disabled, saving, onSave }: {
  member: Member;
  canAssignRoles: boolean;
  disabled: boolean;
  saving: boolean;
  onSave: (memberId: string, role: MemberRole) => Promise<void>;
}) {
  const [selectedRole, setSelectedRole] = useState(member.role);
  useEffect(() => setSelectedRole(member.role), [member.role]);

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="break-words text-sm font-medium">{member.name || member.email || "Unnamed member"}</p>
        {member.email ? <p className="mt-1 break-words text-xs text-muted-foreground">{member.email}</p> : null}
      </div>
      {canAssignRoles ? (
        <form onSubmit={(event) => { event.preventDefault(); void onSave(member.id, selectedRole); }} className="flex shrink-0 items-center gap-2">
          <label htmlFor={`member-role-${member.id}`} className="sr-only">Role for {member.name || member.email || "member"}</label>
          <RoleSelect id={`member-role-${member.id}`} value={selectedRole} onChange={setSelectedRole} disabled={disabled} />
          <Button type="submit" variant="outline" disabled={disabled || selectedRole === member.role} className="h-11 min-w-20 rounded-md">
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      ) : <p className="shrink-0 text-xs text-muted-foreground">{roleLabels[member.role]}</p>}
    </li>
  );
}

function RoleSelect({ id, value, onChange, disabled }: {
  id: string;
  value: MemberRole;
  onChange: (role: MemberRole) => void;
  disabled: boolean;
}) {
  return (
    <select id={id} value={value} onChange={(event) => onChange(event.target.value as MemberRole)} disabled={disabled} className={selectClassName}>
      <option value="member">Member</option>
      <option value="instance-lead">Instance lead</option>
      <option value="admin">Admin</option>
    </select>
  );
}
