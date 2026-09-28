"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  DashboardMember as Member,
  DashboardMembersPage as MembersPage,
  MemberRole,
  MemberStatus,
} from "@/lib/member-types";

type StatusFilter = MemberStatus | "all";
type MemberAction =
  | { action: "approve"; memberNumber?: number }
  | { action: "reject" | "suspend" }
  | { action: "set-number"; memberNumber: number }
  | { action: "set-role"; role: MemberRole };

const roleLabels: Record<MemberRole, string> = {
  member: "Member",
  "instance-lead": "Instance lead",
  admin: "Admin",
};
const statusLabels: Record<StatusFilter, string> = {
  pending: "Pending review",
  approved: "Approved",
  draft: "Drafts",
  rejected: "Rejected",
  suspended: "Suspended",
  all: "All profiles",
};
const filters: StatusFilter[] = [
  "pending",
  "approved",
  "draft",
  "rejected",
  "suspended",
  "all",
];
const selectClassName =
  "focus-ring h-11 w-full rounded-md border border-border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50";
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "America/New_York",
});

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return new Error(typeof body?.error === "string" ? body.error : fallback);
}

export default function MemberManagement({
  canAssignRoles,
  canReview,
  canRenumber,
}: {
  canAssignRoles: boolean;
  canReview: boolean;
  canRenumber: boolean;
}) {
  const [data, setData] = useState<MembersPage | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<
    MemberAction["action"] | null
  >(null);
  const [announcement, setAnnouncement] = useState("");
  const mutationInFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const selected =
    data?.members.find((member) => member.id === selectedId) ?? null;
  const busy = loading || pendingAction !== null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    async function loadMembers() {
      try {
        const response = await fetch(
          `/api/admin/members?page=${page}&status=${status}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw await responseError(
            response,
            "Could not load profiles. Please try again.",
          );
        const result = (await response.json()) as MembersPage;
        if (!controller.signal.aborted) {
          setData(result);
          setSelectedId((current) =>
            result.members.some((member) => member.id === current)
              ? current
              : null,
          );
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load profiles. Please try again.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadMembers();
    return () => controller.abort();
  }, [page, status, revision]);

  useEffect(() => {
    if (selectedId) headingRef.current?.focus();
  }, [selectedId]);

  function selectStatus(nextStatus: StatusFilter) {
    setStatus(nextStatus);
    setPage(1);
    setSelectedId(null);
    setData(null);
    setMutationError(null);
  }

  function returnToQueue() {
    setSelectedId(null);
    setMutationError(null);
    window.requestAnimationFrame(() => queueHeadingRef.current?.focus());
  }

  async function updateMember(memberId: string, action: MemberAction) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setPendingAction(action.action);
    setMutationError(null);
    setAnnouncement("");

    try {
      const response = await fetch(
        `/api/admin/members/${encodeURIComponent(memberId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action),
        },
      );
      if (!response.ok)
        throw await responseError(
          response,
          response.status === 409
            ? "This profile changed or that member number is already in use. Refresh the profile or choose another number."
            : "Could not save this change. Please try again.",
        );
      const { member } = (await response.json()) as { member: Member };
      const messages: Record<MemberAction["action"], string> = {
        approve: `${member.name || "Member"} approved${member.memberNumber !== null ? ` as member #${member.memberNumber}` : ""}.`,
        reject:
          "Application rejected. The applicant can update their profile and submit again.",
        suspend:
          "Membership suspended. This profile is no longer in the directory.",
        "set-number": `Member number changed to #${member.memberNumber}.`,
        "set-role": "Member role updated.",
      };
      setData((current) =>
        current
          ? {
              ...current,
              members: current.members
                .map((entry) => (entry.id === member.id ? member : entry))
                .filter((entry) => status === "all" || entry.status === status),
            }
          : current,
      );
      setAnnouncement(messages[action.action]);
      toast.success(messages[action.action], { position: "top-center" });
      if (status !== "all" && member.status !== status) returnToQueue();
      setRevision((current) => current + 1);
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "Could not save this change. Please try again.",
      );
    } finally {
      mutationInFlight.current = false;
      setPendingAction(null);
    }
  }

  return (
    <section
      aria-labelledby="members-heading"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        className={cn(
          "shrink-0 px-4 sm:px-6 lg:px-0",
          selected && "hidden lg:block",
        )}
      >
        <div className="flex min-h-[72px] items-center justify-between gap-4">
          <div>
            <h1
              ref={queueHeadingRef}
              tabIndex={-1}
              id="members-heading"
              className="focus-ring rounded text-xl font-semibold tracking-tight"
            >
              Applications & members
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Review submitted profiles. Approval adds a member to the
              directory.
            </p>
          </div>
          <Button
            onClick={() => setRevision((current) => current + 1)}
            variant="ghost"
            disabled={busy}
            className="h-11 rounded-md px-3 text-xs"
          >
            <RefreshCw
              aria-hidden="true"
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
        <div
          role="group"
          aria-label="Filter profiles by status"
          className="flex gap-5 overflow-x-auto border-b border-border"
        >
          {filters.map((filter) => (
            <button
              key={filter}
              type="button"
              disabled={pendingAction !== null}
              onClick={() => selectStatus(filter)}
              aria-pressed={status === filter}
              className={cn(
                "focus-ring -mb-px min-h-12 shrink-0 border-b-2 text-sm disabled:opacity-50",
                status === filter
                  ? "border-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {statusLabels[filter]}
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {loadError ? (
        <div role="alert" className="m-4 rounded-lg border border-border p-5">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            variant="outline"
            onClick={() => setRevision((current) => current + 1)}
            className="mt-3"
          >
            Try again
          </Button>
        </div>
      ) : loading && !data ? (
        <p
          role="status"
          className="py-12 text-center text-sm text-muted-foreground"
        >
          Loading profiles…
        </p>
      ) : data ? (
        <div
          aria-busy={loading}
          className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]"
        >
          <div
            className={cn(
              "min-h-0 overflow-y-auto px-4 pb-6 sm:px-6 lg:px-0 lg:pr-5",
              selected && "hidden lg:block",
              loading && "opacity-60",
            )}
          >
            {data.members.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                <p>
                  {status === "pending"
                    ? "No applications waiting for review."
                    : "No profiles in this view."}
                </p>
                <p className="mt-2 text-xs">
                  Members submit their application from their profile.
                </p>
              </div>
            ) : (
              <ul
                aria-label={statusLabels[status]}
                className="divide-y divide-border"
              >
                {data.members.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      disabled={busy}
                      aria-pressed={member.id === selectedId}
                      onClick={() => {
                        setSelectedId(member.id);
                        setMutationError(null);
                      }}
                      className={cn(
                        "focus-ring w-full rounded-md px-3 py-5 text-left disabled:opacity-60",
                        member.id === selectedId
                          ? "bg-secondary"
                          : "hover:bg-muted/40",
                      )}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="break-words text-sm font-semibold">
                          {member.name ||
                            member.fields.name ||
                            member.email ||
                            "Unnamed profile"}
                        </span>
                        {member.memberNumber !== null ? (
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            #{member.memberNumber}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block break-all text-xs text-muted-foreground">
                        {member.email || "No email available"}
                      </span>
                      <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{statusLabels[member.status]}</span>
                        {member.role !== "member" ? (
                          <span>{roleLabels[member.role]}</span>
                        ) : null}
                        {member.submittedAt ? (
                          <time dateTime={member.submittedAt}>
                            {dateFormatter.format(new Date(member.submittedAt))}
                          </time>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <nav
              aria-label="Profile pages"
              className="mt-5 flex items-center justify-between gap-2"
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                Page {data.page}
              </span>
              <div className="flex gap-1">
                <Button
                  aria-label="Previous page"
                  variant="outline"
                  disabled={page === 1 || busy}
                  onClick={() => {
                    setSelectedId(null);
                    setPage((current) => current - 1);
                  }}
                  size="icon"
                  className="h-11 w-11"
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <Button
                  aria-label="Next page"
                  variant="outline"
                  disabled={!data.hasMore || busy}
                  onClick={() => {
                    setSelectedId(null);
                    setPage((current) => current + 1);
                  }}
                  size="icon"
                  className="h-11 w-11"
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          </div>
          <div
            className={cn(
              "min-h-0 overflow-y-auto lg:border-l lg:border-border",
              !selected && "hidden lg:block",
            )}
          >
            {selected ? (
              <MemberDetail
                key={selected.id}
                member={selected}
                headingRef={headingRef}
                canReview={
                  canReview && (selected.role === "member" || canAssignRoles)
                }
                canRenumber={canRenumber}
                canAssignRoles={canAssignRoles}
                busy={busy}
                pendingAction={pendingAction}
                error={mutationError}
                onBack={returnToQueue}
                onUpdate={(action) => updateMember(selected.id, action)}
              />
            ) : (
              <p className="px-6 py-16 text-center text-sm text-muted-foreground">
                Select a profile to read the full application.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MemberDetail({
  member,
  headingRef,
  canReview,
  canRenumber,
  canAssignRoles,
  busy,
  pendingAction,
  error,
  onBack,
  onUpdate,
}: {
  member: Member;
  headingRef: React.Ref<HTMLHeadingElement>;
  canReview: boolean;
  canRenumber: boolean;
  canAssignRoles: boolean;
  busy: boolean;
  pendingAction: MemberAction["action"] | null;
  error: string | null;
  onBack: () => void;
  onUpdate: (action: MemberAction) => Promise<void>;
}) {
  const [numberInput, setNumberInput] = useState("");
  const [newNumber, setNewNumber] = useState(
    member.memberNumber?.toString() ?? "",
  );
  const [selectedRole, setSelectedRole] = useState(member.role);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "reject" | "suspend" | null
  >(null);
  const fields = member.fields;
  const canApprove =
    canReview && ["pending", "rejected", "suspended"].includes(member.status);
  const name = member.name || fields.name || "Unnamed profile";

  useEffect(() => {
    setNewNumber(member.memberNumber?.toString() ?? "");
  }, [member.memberNumber]);
  useEffect(() => {
    setSelectedRole(member.role);
  }, [member.role]);
  useEffect(() => {
    setConfirmAction(null);
  }, [member.status]);

  function readNumber(value: string) {
    if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 2147483646) {
      setNumberError("Enter a whole member number from 1 to 2,147,483,646.");
      return null;
    }
    setNumberError(null);
    return Number(value);
  }

  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const memberNumber =
      canRenumber && numberInput !== "" ? readNumber(numberInput) : undefined;
    if (memberNumber === null) return;
    setNumberError(null);
    void onUpdate({
      action: "approve",
      ...(memberNumber !== undefined ? { memberNumber } : {}),
    });
  }

  return (
    <article
      aria-labelledby="member-detail-heading"
      className="px-5 pb-10 pt-4 sm:px-8 lg:px-10 lg:pt-7"
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        disabled={busy}
        className="mb-4 -ml-3 lg:hidden"
      >
        <ChevronLeft aria-hidden="true" /> Back to profiles
      </Button>
      <header>
        <div className="flex items-start justify-between gap-4">
          <h2
            id="member-detail-heading"
            ref={headingRef}
            tabIndex={-1}
            className="focus-ring break-words rounded text-2xl font-semibold tracking-tight"
          >
            {name}
          </h2>
          {member.memberNumber !== null ? (
            <span className="rounded-full bg-secondary px-3 py-1 text-sm font-medium tabular-nums">
              #{member.memberNumber}
            </span>
          ) : null}
        </div>
        <p className="mt-2 break-all text-sm text-muted-foreground">
          {member.email || "No email available"}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {statusLabels[member.status]} · {roleLabels[member.role]}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {member.submittedAt ? (
            <p>
              Submitted{" "}
              <time dateTime={member.submittedAt}>
                {dateFormatter.format(new Date(member.submittedAt))}
              </time>
            </p>
          ) : (
            <p>Not submitted yet</p>
          )}
          {member.approvedAt ? (
            <p>
              Approved{" "}
              <time dateTime={member.approvedAt}>
                {dateFormatter.format(new Date(member.approvedAt))}
              </time>
            </p>
          ) : null}
        </div>
      </header>

      <dl className="mt-8 grid gap-6 sm:grid-cols-2">
        <Answer label="Application name" value={fields.name} />
        <Answer label="WhatsApp" value={fields.whatsapp} />
        <Answer
          label="Institution and location"
          value={fields.institution}
          wide
        />
        <Answer label="Interests" value={fields.categories.join(", ")} />
        <Answer label="Other interests" value={fields.otherCategory} />
        <Answer label="Bio" value={fields.bio} wide />
        <Answer label="Their WTF idea" value={fields.wtfIdea} wide />
        <Answer label="Current project" value={fields.currentProject} wide />
        <Answer
          label="Application video"
          value={fields.youtubeLink}
          link
          wide
        />
        <Answer label="GitHub" value={fields.github} link />
        <Answer label="Instagram" value={fields.instagram} link />
        <Answer label="LinkedIn" value={fields.linkedin} link />
        <Answer label="Portfolio" value={fields.portfolio} link />
      </dl>

      <div className="mt-8 space-y-5 border-t border-border pt-6">
        {error ? (
          <p
            id="member-action-error"
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
        {numberError ? (
          <p
            id="member-number-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {numberError}
          </p>
        ) : null}
        {canApprove ? (
          <form onSubmit={approve} className="space-y-3">
            <h3 className="text-sm font-semibold">
              {member.status === "suspended"
                ? "Restore membership"
                : "Approve application"}
            </h3>
            {canRenumber ? (
              <div>
                <label
                  htmlFor="approval-member-number"
                  className="mb-1.5 block text-xs font-medium"
                >
                  Member number{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </label>
                <Input
                  id="approval-member-number"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={2147483646}
                  step={1}
                  value={numberInput}
                  onChange={(event) => {
                    setNumberInput(event.target.value);
                    setNumberError(null);
                  }}
                  disabled={busy}
                  placeholder={
                    member.memberNumber !== null
                      ? `Keep #${member.memberNumber}`
                      : "Assign automatically"
                  }
                  aria-describedby="approval-number-help"
                  className="max-w-xs"
                />
              </div>
            ) : null}
            <p
              id="approval-number-help"
              className="text-xs leading-5 text-muted-foreground"
            >
              {member.memberNumber !== null
                ? `Leave the number unchanged to keep #${member.memberNumber}.`
                : "An unused member number is assigned automatically in approval order."}{" "}
              Approval makes this profile visible in the member directory.
            </p>
            <Button
              type="submit"
              disabled={busy}
              aria-describedby={error ? "member-action-error" : undefined}
            >
              {pendingAction === "approve" ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : null}
              {pendingAction === "approve"
                ? "Approving…"
                : member.status === "suspended"
                  ? "Restore membership"
                  : "Approve membership"}
            </Button>
          </form>
        ) : member.status === "draft" ? (
          <p className="text-sm text-muted-foreground">
            This profile is still a draft. Review becomes available after the
            applicant submits it.
          </p>
        ) : null}

        {canReview &&
        (member.status === "pending" || member.status === "approved") ? (
          <div>
            {confirmAction ? (
              <div className="rounded-lg border border-border p-4">
                <p className="text-sm font-medium">
                  {confirmAction === "reject"
                    ? `Reject ${name}’s application?`
                    : `Suspend ${name}’s membership?`}
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {confirmAction === "reject"
                    ? "They can update their profile and submit it again."
                    : "They will lose member access and disappear from the directory. Their profile and member number are kept."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void onUpdate({ action: confirmAction })}
                  >
                    {pendingAction === confirmAction
                      ? "Saving…"
                      : confirmAction === "reject"
                        ? "Reject application"
                        : "Suspend membership"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setConfirmAction(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setConfirmAction(
                    member.status === "pending" ? "reject" : "suspend",
                  )
                }
              >
                {member.status === "pending"
                  ? "Reject application…"
                  : "Suspend membership…"}
              </Button>
            )}
          </div>
        ) : null}
        {!canReview && member.role !== "member" ? (
          <p className="text-xs text-muted-foreground">
            Only admins can review or suspend a dashboard member.
          </p>
        ) : null}

        {canRenumber && member.memberNumber !== null ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const number = readNumber(newNumber);
              if (number !== null)
                void onUpdate({ action: "set-number", memberNumber: number });
            }}
            className="border-t border-border pt-5"
          >
            <label
              htmlFor="existing-member-number"
              className="mb-1.5 block text-sm font-semibold"
            >
              Change member number
            </label>
            <p
              id="existing-number-help"
              className="mb-3 text-xs leading-5 text-muted-foreground"
            >
              Every member number must be unique. A number already in use cannot
              be assigned.
            </p>
            <div className="flex flex-wrap gap-2">
              <Input
                id="existing-member-number"
                type="number"
                inputMode="numeric"
                required
                min={1}
                max={2147483646}
                step={1}
                value={newNumber}
                onChange={(event) => {
                  setNewNumber(event.target.value);
                  setNumberError(null);
                }}
                disabled={busy}
                aria-describedby="existing-number-help"
                className="w-40"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={busy || newNumber === String(member.memberNumber)}
              >
                {pendingAction === "set-number" ? "Saving…" : "Save number"}
              </Button>
            </div>
          </form>
        ) : null}

        {canAssignRoles && (member.status === "approved" || (member.status === "suspended" && member.role !== "member")) ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onUpdate({ action: "set-role", role: selectedRole });
            }}
            className="border-t border-border pt-5"
          >
            <label
              htmlFor="member-role"
              className="mb-1.5 block text-sm font-semibold"
            >
              Dashboard role
            </label>
            <p
              id="member-role-help"
              className="mb-3 text-xs leading-5 text-muted-foreground"
            >
              {member.status === "suspended"
                ? "Remove staff privileges while keeping membership suspended. Restore membership before granting a role."
                : "Instance leads review applications. Admins also assign roles and member numbers."}
            </p>
            <div className="flex flex-wrap gap-2">
              <select
                id="member-role"
                value={selectedRole}
                onChange={(event) =>
                  setSelectedRole(event.target.value as MemberRole)
                }
                disabled={busy}
                aria-describedby="member-role-help"
                className={cn(selectClassName, "max-w-48")}
              >
                <option value="member">Member</option>
                <option value="instance-lead" disabled={member.status !== "approved"}>Instance lead</option>
                <option value="admin" disabled={member.status !== "approved"}>Admin</option>
              </select>
              <Button
                type="submit"
                variant="outline"
                disabled={busy || selectedRole === member.role}
              >
                {pendingAction === "set-role" ? "Saving…" : "Save role"}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </article>
  );
}

function Answer({
  label,
  value,
  link = false,
  wide = false,
}: {
  label: string;
  value: string;
  link?: boolean;
  wide?: boolean;
}) {
  let href: string | null = null;
  if (link && value) {
    try {
      const url = new URL(value);
      if (
        ["http:", "https:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      )
        href = url.href;
    } catch {
      /* Display malformed or incomplete draft URLs as text. */
    }
  }
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="mb-1.5 text-xs font-semibold text-muted-foreground">
        {label}
      </dt>
      <dd className="whitespace-pre-wrap break-words text-sm leading-6">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex max-w-full items-start gap-1 rounded text-link underline underline-offset-4"
          >
            <span className="break-all">{value}</span>
            <ArrowUpRight
              aria-hidden="true"
              className="mt-1 h-3.5 w-3.5 shrink-0"
            />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          value || <span className="text-muted-foreground">Not provided</span>
        )}
      </dd>
    </div>
  );
}
