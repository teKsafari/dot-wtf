"use client";

import Link from "next/link";
import {
  type ReactNode,
  type Ref,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { signOut } from "next-auth/react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import {
  Archive as ArchiveIcon,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Wordmark from "@/components/wordmark";
import { cn } from "@/lib/utils";

export interface AdminSubmission {
  id: number;
  name: string;
  email: string;
  categories?: string;
  otherCategory?: string | null;
  wtfIdea?: string;
  currentProject?: string;
  youtubeLink?: string;
  whatsapp?: string | null;
  interests?: string | null;
  isApproved: boolean | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminDashboardProps {
  admin: {
    email: string;
    name: string;
    role: string;
  };
  initialSubmissions: AdminSubmission[];
}

type SubmissionFilter = "all" | "pending" | "approved" | "waitlist" | "archive";
type SubmissionAction = "approve" | "waitlist" | "archive" | "restore";

const PAGE_SIZE = 12;

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/New_York",
});

const statusCopy = {
  approved: {
    label: "Approved",
  },
  pending: {
    label: "Pending",
  },
  waitlist: {
    label: "Waitlisted",
  },
} as const;

export default function AdminDashboard({
  admin,
  initialSubmissions,
}: AdminDashboardProps) {
  const [submissions, setSubmissions] =
    useState<AdminSubmission[]>(initialSubmissions);
  const [filter, setFilter] = useState<SubmissionFilter>("pending");
  const [search, setSearch] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<
    number | null
  >(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingMutation, setPendingMutation] = useState<{
    submissionId: number;
    action: SubmissionAction;
  } | null>(null);
  const requestInFlightRef = useRef(false);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const queueFocusRestoreIdRef = useRef<number | null>(null);
  const pageFocusRequestedRef = useRef(false);
  const detailNavigationRequestedRef = useRef(false);
  const deferredQuery = useDeferredValue(search.trim());
  const normalizedSearch = deferredQuery.toLowerCase();

  const stats = useMemo(() => getSubmissionStats(submissions), [submissions]);
  const filterOptions = [
    { id: "pending", label: "Pending", count: stats.pending },
    { id: "approved", label: "Approved", count: stats.approved },
    { id: "waitlist", label: "Waitlist", count: stats.waitlist },
    { id: "all", label: "All", count: stats.total },
    { id: "archive", label: "Archive", count: stats.archived },
  ] as const satisfies ReadonlyArray<{
    id: SubmissionFilter;
    label: string;
    count: number;
  }>;

  const filteredSubmissions = useMemo(
    () =>
      submissions.filter((submission) =>
        submissionMatchesView(submission, filter, normalizedSearch),
      ),
    [filter, normalizedSearch, submissions],
  );

  const pageCount = Math.max(
    1,
    Math.ceil(filteredSubmissions.length / PAGE_SIZE),
  );
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const visibleSubmissions = filteredSubmissions.slice(
    safePageIndex * PAGE_SIZE,
    (safePageIndex + 1) * PAGE_SIZE,
  );
  const firstVisibleSubmissionId = visibleSubmissions[0]?.id;
  const selectedSubmission = useMemo(
    () =>
      submissions.find(
        (submission) => submission.id === selectedSubmissionId,
      ) ?? null,
    [selectedSubmissionId, submissions],
  );
  const { previousSubmission, nextSubmission } = useMemo(() => {
    const selectedIndex = submissions.findIndex(
      (submission) => submission.id === selectedSubmissionId,
    );
    let previous: AdminSubmission | null = null;
    let next: AdminSubmission | null = null;

    if (selectedIndex < 0) {
      return { previousSubmission: previous, nextSubmission: next };
    }

    for (let index = selectedIndex - 1; index >= 0; index -= 1) {
      if (submissionMatchesView(submissions[index], filter, normalizedSearch)) {
        previous = submissions[index];
        break;
      }
    }

    for (
      let index = selectedIndex + 1;
      index < submissions.length;
      index += 1
    ) {
      if (submissionMatchesView(submissions[index], filter, normalizedSearch)) {
        next = submissions[index];
        break;
      }
    }

    return { previousSubmission: previous, nextSubmission: next };
  }, [filter, normalizedSearch, selectedSubmissionId, submissions]);
  useEffect(() => {
    const navigatedWithinDetail = detailNavigationRequestedRef.current;
    detailNavigationRequestedRef.current = false;

    if (
      selectedSubmissionId !== null &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      if (navigatedWithinDetail) {
        return;
      }

      const frameId = window.requestAnimationFrame(() => {
        detailHeadingRef.current?.focus();
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    const rowId = queueFocusRestoreIdRef.current;

    if (selectedSubmissionId === null && rowId !== null) {
      const frameId = window.requestAnimationFrame(() => {
        const queueTarget =
          document.getElementById("submission-row-" + rowId) ??
          document.querySelector<HTMLButtonElement>("[data-submission-row]") ??
          document.getElementById("submission-filter-" + filter) ??
          document.getElementById("applications-heading");
        queueTarget?.focus();
        queueFocusRestoreIdRef.current = null;
      });

      return () => window.cancelAnimationFrame(frameId);
    }
  }, [filter, selectedSubmissionId]);

  useEffect(() => {
    if (
      !pageFocusRequestedRef.current ||
      firstVisibleSubmissionId === undefined
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      document
        .getElementById("submission-row-" + firstVisibleSubmissionId)
        ?.focus();
      pageFocusRequestedRef.current = false;
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [firstVisibleSubmissionId, safePageIndex]);

  const selectFilter = (nextFilter: SubmissionFilter) => {
    setFilter(nextFilter);
    setPageIndex(0);
    setSelectedSubmissionId(null);
  };

  const updateSearch = (nextSearch: string) => {
    setSearch(nextSearch);
    setPageIndex(0);
    setSelectedSubmissionId(null);
  };

  const resetView = () => {
    setFilter("all");
    setSearch("");
    setPageIndex(0);
    setSelectedSubmissionId(null);
  };

  const viewArchive = () => {
    setFilter("archive");
    setSearch("");
    setPageIndex(0);
    setSelectedSubmissionId(null);
  };

  const refreshSubmissions = async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/admin/submissions", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch submissions");
      }

      const refreshedSubmissions = (await response.json()) as AdminSubmission[];

      setSubmissions(refreshedSubmissions);
      setPageIndex(0);
      setSelectedSubmissionId((currentId) => {
        if (currentId === null) return null;

        const currentSubmission = refreshedSubmissions.find(
          (submission) => submission.id === currentId,
        );

        if (
          currentSubmission &&
          submissionMatchesView(currentSubmission, filter, normalizedSearch)
        ) {
          return currentId;
        }

        queueFocusRestoreIdRef.current = currentId;
        return null;
      });
      toast.success("Application queue refreshed.", { position: "top-center" });
    } catch (error) {
      console.error("Refresh error:", error);
      toast.error(
        "Could not refresh the queue. Check your connection and try again.",
        { position: "top-center" },
      );
    } finally {
      requestInFlightRef.current = false;
      setIsRefreshing(false);
    }
  };

  const updateSubmission = async (
    submissionId: number,
    action: SubmissionAction,
  ) => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setPendingMutation({ submissionId, action });

    try {
      const response = await fetch("/api/admin/submissions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: submissionId, action }),
      });

      if (response.status === 409) {
        toast.error(
          "This application changed elsewhere. Refresh the queue and try again.",
          { position: "top-center" },
        );
        return;
      }

      if (response.status === 404) {
        toast.error(
          "This application is no longer available. Refresh the queue.",
          {
            position: "top-center",
          },
        );
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to update submission");
      }

      const updatedSubmission = (await response.json()) as AdminSubmission;

      if (!updatedSubmission?.id) {
        throw new Error("The server returned an invalid submission");
      }

      setSubmissions((currentSubmissions) =>
        currentSubmissions.map((submission) =>
          submission.id === submissionId ? updatedSubmission : submission,
        ),
      );

      if (action === "archive" || action === "restore") {
        queueFocusRestoreIdRef.current = submissionId;
        setSelectedSubmissionId(null);
        setPageIndex(0);
      }

      const successCopy: Record<SubmissionAction, string> = {
        approve: "Application approved.",
        waitlist: "Application moved to the waitlist.",
        archive: "Application archived.",
        restore: "Application restored.",
      };
      toast.success(successCopy[action], { position: "top-center" });
    } catch (error) {
      console.error("Update error:", error);
      toast.error(
        "Could not save this change. Check your connection and try again.",
        { position: "top-center" },
      );
    } finally {
      requestInFlightRef.current = false;
      setPendingMutation(null);
    }
  };

  const returnToQueue = () => {
    queueFocusRestoreIdRef.current = selectedSubmissionId;
    setSelectedSubmissionId(null);
  };

  const navigateToSubmission = (submissionId: number) => {
    const targetIndex = filteredSubmissions.findIndex(
      (submission) => submission.id === submissionId,
    );

    if (targetIndex >= 0) {
      setPageIndex(Math.floor(targetIndex / PAGE_SIZE));
    }

    detailNavigationRequestedRef.current = true;
    setSelectedSubmissionId(submissionId);
  };

  const changePage = (nextPage: number) => {
    pageFocusRequestedRef.current = true;
    setPageIndex(nextPage);
    setSelectedSubmissionId(null);
  };

  const hasSelectedSubmission = selectedSubmission !== null;
  const activeAction =
    pendingMutation?.submissionId === selectedSubmissionId
      ? pendingMutation.action
      : null;

  return (
    <div className="flex h-[100svh] flex-col overflow-hidden bg-background text-foreground">
      <a
        href="#admin-main"
        className="focus-ring sr-only z-50 rounded-md bg-primary px-4 py-3 text-primary-foreground focus:fixed focus:left-4 focus:top-4 focus:not-sr-only"
      >
        Skip to content
      </a>

      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="Back to CWRU.WTF home"
            className="focus-ring inline-flex min-h-11 items-center gap-3 rounded text-foreground"
          >
            <span translate="no" className="font-brand text-base font-semibold">
              <Wordmark />
            </span>
            <span aria-hidden="true" className="text-border">
              /
            </span>
            <span className="text-sm text-muted-foreground">Admin</span>
          </Link>
          <div className="flex min-w-0 items-center gap-2">
            <span
              title={admin.email}
              className="hidden max-w-48 truncate text-xs text-muted-foreground sm:block"
            >
              {admin.name}
            </span>
            <Button
              onClick={() => signOut({ callbackUrl: "/" })}
              variant="ghost"
              size="icon"
              className="h-11 w-11 rounded-md"
              aria-label="Sign out of the admin dashboard"
              title="Sign out"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main
        id="admin-main"
        tabIndex={-1}
        className="mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col outline-none lg:px-8"
      >
        <div
          className={cn(
            "shrink-0 px-4 sm:px-6 lg:px-0",
            hasSelectedSubmission && "hidden lg:block",
          )}
        >
          <div className="flex h-[72px] items-center justify-between gap-4">
            <h1
              id="applications-heading"
              tabIndex={-1}
              className="focus-ring rounded text-xl font-semibold tracking-tight"
            >
              Applications
            </h1>
            <Button
              onClick={refreshSubmissions}
              variant="ghost"
              disabled={isRefreshing || pendingMutation !== null}
              aria-busy={isRefreshing}
              className="h-11 rounded-md px-3 text-xs"
            >
              <RefreshCw
                aria-hidden="true"
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          <div className="flex flex-col-reverse gap-2 border-b border-border lg:flex-row lg:items-center lg:justify-between lg:gap-6">
            <div
              className="flex w-full items-center gap-5 overflow-x-auto sm:gap-6 lg:w-auto"
              role="group"
              aria-label="Filter applications by status"
            >
              {filterOptions.map((option) => (
                <button
                  id={"submission-filter-" + option.id}
                  key={option.id}
                  type="button"
                  onClick={() => selectFilter(option.id)}
                  aria-pressed={filter === option.id}
                  className={cn(
                    "focus-ring -mb-px inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 text-sm",
                    filter === option.id
                      ? "border-foreground font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                  {option.id === "pending" || option.id === "archive" ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {numberFormatter.format(option.count)}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>

            <div className="relative mb-1 w-full lg:w-72">
              <label htmlFor="application-search" className="sr-only">
                Search applications
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="application-search"
                name="application-search"
                type="search"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Search applications…"
                className="h-10 rounded-md bg-muted/25 py-2 pl-9 pr-10 text-base lg:h-9 lg:text-sm [&::-webkit-search-cancel-button]:appearance-none"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => updateSearch("")}
                  aria-label="Clear application search"
                  className="focus-ring absolute right-0 top-0 flex h-full w-10 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <section
          aria-label="Application review workspace"
          className="flex min-h-0 flex-1 lg:grid lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]"
        >
          <div
            className={cn(
              "min-h-0 w-full flex-col",
              hasSelectedSubmission ? "hidden lg:flex" : "flex",
            )}
          >
            {visibleSubmissions.length === 0 ? (
              <QueueEmptyState
                filter={filter}
                hasSearch={Boolean(deferredQuery)}
                total={stats.total}
                archivedTotal={stats.archived}
                onClearSearch={() => updateSearch("")}
                onViewArchive={viewArchive}
                onViewAll={resetView}
              />
            ) : (
              <ul
                aria-label="Applications"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
              >
                {visibleSubmissions.map((submission) => (
                  <li key={submission.id} className="border-b border-border/70">
                    <SubmissionRow
                      isSelected={selectedSubmissionId === submission.id}
                      statusLabel={
                        filter === "all"
                          ? getStatusTone(submission.isApproved).label
                          : filter === "archive"
                            ? "Previously " +
                              getStatusTone(submission.isApproved).label
                            : undefined
                      }
                      onSelect={() => setSelectedSubmissionId(submission.id)}
                      submission={submission}
                    />
                  </li>
                ))}
              </ul>
            )}
            {filteredSubmissions.length > 0 ? (
              <QueuePagination
                pageCount={pageCount}
                pageIndex={safePageIndex}
                total={filteredSubmissions.length}
                onPageChange={changePage}
              />
            ) : null}
            <p className="sr-only" role="status">
              {filteredSubmissions.length} applications in this view.
            </p>
          </div>

          <div
            className={cn(
              "min-h-0 min-w-0 w-full lg:flex lg:border-l lg:border-border",
              hasSelectedSubmission ? "flex" : "hidden",
            )}
          >
            {selectedSubmission ? (
              <SubmissionDetail
                activeAction={activeAction}
                actionsDisabled={pendingMutation !== null || isRefreshing}
                headingRef={detailHeadingRef}
                nextSubmission={nextSubmission}
                onBack={returnToQueue}
                onAction={updateSubmission}
                onNavigate={navigateToSubmission}
                previousSubmission={previousSubmission}
                submission={selectedSubmission}
              />
            ) : (
              <div className="flex w-full items-center justify-center p-8 text-sm text-muted-foreground">
                {visibleSubmissions.length > 0
                  ? "Select an application to read it."
                  : "No application selected."}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function SubmissionRow({
  submission,
  isSelected,
  statusLabel,
  onSelect,
}: {
  submission: AdminSubmission;
  isSelected: boolean;
  statusLabel?: string;
  onSelect: () => void;
}) {
  return (
    <button
      id={"submission-row-" + submission.id}
      data-submission-row
      type="button"
      onClick={onSelect}
      aria-label={
        submission.name +
        ", submitted " +
        formatDateTime(submission.createdAt) +
        (statusLabel ? ", " + statusLabel : "")
      }
      aria-current={isSelected ? "true" : undefined}
      className={cn(
        "focus-ring w-full border-l-2 px-4 py-4 text-left focus-visible:relative focus-visible:z-10 focus-visible:ring-inset sm:px-5",
        isSelected
          ? "border-l-foreground bg-muted/55"
          : "border-l-transparent hover:bg-muted/30",
      )}
    >
      <span className="flex min-w-0 items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">
          {submission.name}
        </span>
        <time
          dateTime={submission.createdAt}
          title={formatDateTime(submission.createdAt)}
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
        >
          {formatShortDate(submission.createdAt)}
        </time>
      </span>
      <span className="mt-1.5 line-clamp-2 break-words text-[13px] leading-5 text-muted-foreground">
        {submission.wtfIdea || "No idea shared."}
      </span>
      {statusLabel ? (
        <span className="mt-2 block text-xs text-muted-foreground">
          {statusLabel}
        </span>
      ) : null}
    </button>
  );
}

function SubmissionDetail({
  submission,
  onBack,
  onAction,
  activeAction,
  actionsDisabled,
  headingRef,
  previousSubmission,
  nextSubmission,
  onNavigate,
}: {
  submission: AdminSubmission;
  onBack: () => void;
  onAction: (submissionId: number, action: SubmissionAction) => Promise<void>;
  activeAction: SubmissionAction | null;
  actionsDisabled: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  previousSubmission: AdminSubmission | null;
  nextSubmission: AdminSubmission | null;
  onNavigate: (submissionId: number) => void;
}) {
  const categories = parseCategories(
    submission.categories,
    submission.otherCategory ?? null,
  );
  const videoReferenceUrl = getSafeExternalUrl(submission.youtubeLink);
  const headingId = "submission-detail-" + submission.id;
  const isPending = submission.isApproved === null;
  const isArchived = submission.archivedAt !== null;
  const previousSubmissionStateRef = useRef({
    id: submission.id,
    status: submission.isApproved,
  });
  const detailBodyRef = useRef<HTMLDivElement>(null);
  const savedStatusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (detailBodyRef.current) {
        detailBodyRef.current.scrollTop = 0;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [submission.id]);

  useEffect(() => {
    const previousSubmissionState = previousSubmissionStateRef.current;

    if (
      previousSubmissionState.id === submission.id &&
      previousSubmissionState.status !== submission.isApproved &&
      submission.isApproved !== null
    ) {
      savedStatusRef.current?.focus();
    }

    previousSubmissionStateRef.current = {
      id: submission.id,
      status: submission.isApproved,
    };
  }, [submission.id, submission.isApproved]);

  const approveButton = (
    <Button
      onClick={() => onAction(submission.id, "approve")}
      disabled={actionsDisabled}
      aria-busy={activeAction === "approve"}
      aria-label={"Approve " + submission.name}
      className="h-11 flex-1 rounded-md px-3 shadow-none active:translate-y-0 active:scale-[0.98] sm:flex-none sm:px-5"
    >
      {activeAction === "approve" ? (
        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
      ) : (
        <Check aria-hidden="true" className="h-4 w-4" />
      )}
      {activeAction === "approve" ? "Approving…" : "Approve"}
    </Button>
  );

  const archiveButton = (
    <Button
      onClick={() => onAction(submission.id, "archive")}
      disabled={actionsDisabled}
      aria-busy={activeAction === "archive"}
      aria-label={"Archive " + submission.name}
      title="Archive"
      variant="ghost"
      className="h-11 w-11 shrink-0 rounded-md px-0 text-muted-foreground shadow-none active:translate-y-0 active:scale-[0.98] hover:text-foreground sm:w-auto sm:px-4"
    >
      {activeAction === "archive" ? (
        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
      ) : (
        <ArchiveIcon aria-hidden="true" className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">
        {activeAction === "archive" ? "Archiving…" : "Archive"}
      </span>
    </Button>
  );

  return (
    <article
      aria-labelledby={headingId}
      className="relative flex min-h-0 w-full flex-col"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 lg:hidden">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring inline-flex min-h-12 items-center gap-1 rounded px-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Applications
        </button>
        <ApplicationNavigation
          disabled={actionsDisabled}
          previousSubmission={previousSubmission}
          nextSubmission={nextSubmission}
          onNavigate={onNavigate}
        />
      </div>

      <ApplicationNavigation
        disabled={actionsDisabled}
        previousSubmission={previousSubmission}
        nextSubmission={nextSubmission}
        onNavigate={onNavigate}
        className="pointer-events-none absolute inset-x-0 top-1/2 z-10 hidden -translate-y-1/2 justify-between px-3 lg:flex"
      />

      <div
        key={submission.id}
        ref={detailBodyRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
      >
        <div className="mx-auto max-w-[760px] px-5 py-7 sm:px-8 lg:px-16 lg:py-9">
          <header>
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="focus-ring break-words rounded font-brand text-2xl font-semibold tracking-tight"
            >
              {submission.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <a
                className="focus-ring break-all rounded py-1 underline-offset-4 hover:text-foreground hover:underline"
                href={"mailto:" + submission.email}
              >
                {submission.email}
              </a>
              {submission.whatsapp ? (
                <a
                  className="focus-ring break-all rounded py-1 underline-offset-4 hover:text-foreground hover:underline"
                  href={"tel:" + submission.whatsapp}
                >
                  {submission.whatsapp}
                </a>
              ) : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Submitted{" "}
              <time dateTime={submission.createdAt}>
                {formatDateTime(submission.createdAt)}
              </time>
            </p>
          </header>

          <div className="mt-8 space-y-7">
            <DetailSection title="Idea">
              <p className="whitespace-pre-wrap break-words text-[15px] leading-7">
                {submission.wtfIdea || "No idea shared."}
              </p>
            </DetailSection>
            <DetailSection title="Current project">
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {submission.currentProject || "No project shared."}
              </p>
            </DetailSection>
            {categories.length > 0 || submission.interests ? (
              <DetailSection title="Interests">
                {categories.length > 0 ? (
                  <p className="break-words text-sm leading-6">
                    {categories.join(", ")}
                  </p>
                ) : null}
                {submission.interests ? (
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {submission.interests}
                  </p>
                ) : null}
              </DetailSection>
            ) : null}
            {videoReferenceUrl ? (
              <VideoReference url={videoReferenceUrl} name={submission.name} />
            ) : null}
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-background px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8 lg:px-6">
        {isArchived ? (
          <div className="flex min-h-11 items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" role="status">
              Archived · Previously {getStatusTone(submission.isApproved).label}
            </p>
            <Button
              onClick={() => onAction(submission.id, "restore")}
              disabled={actionsDisabled}
              aria-busy={activeAction === "restore"}
              variant="outline"
              className="h-11 rounded-md shadow-none active:translate-y-0 active:scale-[0.98]"
            >
              {activeAction === "restore" ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : (
                <ArchiveRestore aria-hidden="true" className="h-4 w-4" />
              )}
              {activeAction === "restore" ? "Restoring…" : "Restore"}
            </Button>
          </div>
        ) : isPending ? (
          <div className="flex items-center justify-end gap-2">
            {archiveButton}
            <WaitlistSubmissionDialog
              key={submission.id}
              activeAction={activeAction}
              disabled={actionsDisabled}
              name={submission.name}
              onWaitlist={() => onAction(submission.id, "waitlist")}
            />
            {approveButton}
          </div>
        ) : (
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
            <p
              ref={savedStatusRef}
              tabIndex={-1}
              className="focus-ring rounded text-sm text-muted-foreground"
              role="status"
            >
              {getStatusTone(submission.isApproved).label}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {archiveButton}
              {submission.isApproved === false ? approveButton : null}
            </div>
          </div>
        )}
      </footer>
    </article>
  );
}

function ApplicationNavigation({
  previousSubmission,
  nextSubmission,
  onNavigate,
  disabled,
  className,
}: {
  previousSubmission: AdminSubmission | null;
  nextSubmission: AdminSubmission | null;
  onNavigate: (submissionId: number) => void;
  disabled: boolean;
  className?: string;
}) {
  if (!previousSubmission && !nextSubmission) {
    return null;
  }

  return (
    <nav
      aria-label="Browse applications"
      className={cn("flex items-center gap-1", className)}
    >
      <ApplicationNavigationButton
        direction="previous"
        disabled={disabled}
        submission={previousSubmission}
        onNavigate={onNavigate}
      />
      <ApplicationNavigationButton
        direction="next"
        disabled={disabled}
        submission={nextSubmission}
        onNavigate={onNavigate}
      />
    </nav>
  );
}

function ApplicationNavigationButton({
  direction,
  submission,
  onNavigate,
  disabled,
}: {
  direction: "previous" | "next";
  submission: AdminSubmission | null;
  onNavigate: (submissionId: number) => void;
  disabled: boolean;
}) {
  const isPrevious = direction === "previous";
  const directionLabel = isPrevious ? "Previous" : "Next";
  const label = submission
    ? directionLabel + " application: " + submission.name
    : "No " + direction + " application";

  return (
    <button
      type="button"
      onClick={() => submission && onNavigate(submission.id)}
      disabled={disabled || !submission}
      aria-label={label}
      title={label}
      className="focus-ring pointer-events-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm backdrop-blur-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-30"
    >
      {isPrevious ? (
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      ) : (
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      )}
    </button>
  );
}

function VideoReference({ url, name }: { url: string; name: string }) {
  const embedUrl = getYouTubeEmbedUrl(url);

  return (
    <DetailSection title="Video">
      {embedUrl ? (
        <iframe
          src={embedUrl}
          title={name + " YouTube reference"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="block aspect-video w-full rounded-md border border-border"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : null}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "focus-ring flex min-h-11 w-fit items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground hover:underline",
          embedUrl && "mt-2",
        )}
      >
        Open video
        <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </DetailSection>
  );
}

function WaitlistSubmissionDialog({
  name,
  disabled,
  activeAction,
  onWaitlist,
}: {
  name: string;
  disabled: boolean;
  activeAction: SubmissionAction | null;
  onWaitlist: () => Promise<void>;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button
          disabled={disabled}
          aria-busy={activeAction === "waitlist"}
          aria-label={"Move " + name + " to the waitlist"}
          variant="outline"
          className="h-11 flex-1 rounded-md px-3 shadow-none active:translate-y-0 active:scale-[0.98] sm:flex-none sm:px-5"
        >
          {activeAction === "waitlist" ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : null}
          {activeAction === "waitlist" ? "Moving…" : "Waitlist"}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/25" />
        <AlertDialog.Content className="focus-ring fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background p-6 shadow-lg">
          <AlertDialog.Title className="text-lg font-semibold tracking-tight">
            Move to the waitlist?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 break-words text-sm leading-6 text-muted-foreground">
            {name} will remain available in Waitlist and can be approved later.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" className="h-11 rounded-md shadow-none">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                onClick={() => void onWaitlist()}
                disabled={disabled}
                className="h-11 rounded-md shadow-none"
              >
                Move to waitlist
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 font-brand text-xs font-semibold text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function QueueEmptyState({
  filter,
  hasSearch,
  total,
  archivedTotal,
  onClearSearch,
  onViewArchive,
  onViewAll,
}: {
  filter: SubmissionFilter;
  hasSearch: boolean;
  total: number;
  archivedTotal: number;
  onClearSearch: () => void;
  onViewArchive: () => void;
  onViewAll: () => void;
}) {
  let title = filter === "archive" ? "Archive is empty" : "No applications";
  let description = "New applications will appear here.";

  if (hasSearch) {
    title = filter === "archive" ? "No matches in Archive" : "No matches";
    description = "Try another name, email, or idea.";
  } else if (filter === "pending") {
    title = "No pending applications";
    description = "New applications will appear here for review.";
  } else if (filter === "approved") {
    title = "No approved applications";
    description = "Approved applications will appear here.";
  } else if (filter === "waitlist") {
    title = "No waitlisted applications";
    description = "Applications moved to the waitlist will appear here.";
  } else if (filter === "archive") {
    description = "Archived applications will appear here.";
  } else if (total === 0) {
    title = "No active applications";
    description =
      archivedTotal > 0
        ? "All current applications are in the archive."
        : description;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
        <Inbox aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
        <h2 className="mt-4 text-sm font-medium">{title}</h2>
        <p className="mt-2 max-w-64 text-[13px] leading-5 text-muted-foreground">
          {description}
        </p>
        {hasSearch ? (
          <Button
            onClick={onClearSearch}
            variant="ghost"
            className="mt-3 h-11 rounded-md text-xs"
          >
            Clear search
          </Button>
        ) : total > 0 && filter !== "all" ? (
          <Button
            onClick={onViewAll}
            variant="ghost"
            className="mt-3 h-11 rounded-md text-xs"
          >
            View all applications
          </Button>
        ) : filter !== "archive" && total === 0 && archivedTotal > 0 ? (
          <Button
            onClick={onViewArchive}
            variant="ghost"
            className="mt-3 h-11 rounded-md text-xs"
          >
            View archive
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function QueuePagination({
  pageIndex,
  pageCount,
  total,
  onPageChange,
}: {
  pageIndex: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const rangeStart = pageIndex * PAGE_SIZE + 1;
  const rangeEnd = Math.min((pageIndex + 1) * PAGE_SIZE, total);

  return (
    <nav
      aria-label="Application queue pages"
      className="flex min-h-[69px] shrink-0 items-center justify-between gap-3 border-t border-border px-4 sm:px-5"
    >
      <p
        className="text-xs tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {numberFormatter.format(rangeStart)}–{numberFormatter.format(rangeEnd)}{" "}
        of {numberFormatter.format(total)}
        <span className="sr-only">
          {" "}
          applications. Page {pageIndex + 1} of {pageCount}.
        </span>
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center">
          <Button
            size="icon"
            variant="ghost"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
            aria-label="Previous page"
            className="h-11 w-11 rounded-md"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
            aria-label="Next page"
            className="h-11 w-11 rounded-md"
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </nav>
  );
}

function submissionMatchesView(
  submission: AdminSubmission,
  filter: SubmissionFilter,
  normalizedSearch: string,
) {
  const isArchived = submission.archivedAt !== null;

  if (filter === "archive") {
    if (!isArchived) return false;
  } else {
    if (isArchived) return false;

    if (filter === "pending" && submission.isApproved !== null) return false;
    if (filter === "approved" && submission.isApproved !== true) return false;
    if (filter === "waitlist" && submission.isApproved !== false) return false;
  }

  return (
    normalizedSearch.length === 0 ||
    buildSearchBlob(submission).includes(normalizedSearch)
  );
}

function getSubmissionStats(submissions: AdminSubmission[]) {
  return submissions.reduce(
    (accumulator, submission) => {
      if (submission.archivedAt !== null) {
        accumulator.archived += 1;
        return accumulator;
      }

      accumulator.total += 1;

      if (submission.isApproved === null) {
        accumulator.pending += 1;
      } else if (submission.isApproved) {
        accumulator.approved += 1;
      } else {
        accumulator.waitlist += 1;
      }

      return accumulator;
    },
    {
      approved: 0,
      archived: 0,
      pending: 0,
      total: 0,
      waitlist: 0,
    },
  );
}

function getStatusTone(status: boolean | null) {
  if (status === true) {
    return statusCopy.approved;
  }

  if (status === false) {
    return statusCopy.waitlist;
  }

  return statusCopy.pending;
}

function parseCategories(
  categories: string | undefined,
  otherCategory: string | null,
) {
  if (!categories) {
    return [];
  }

  try {
    const parsedCategories = JSON.parse(categories) as unknown;

    if (!Array.isArray(parsedCategories)) {
      return [];
    }

    return parsedCategories
      .filter((category): category is string => typeof category === "string")
      .map((category) =>
        category === "Other" && otherCategory
          ? "Other: " + otherCategory
          : category,
      );
  } catch (error) {
    console.error("Category parse error:", error);
    return [];
  }
}

function buildSearchBlob(submission: AdminSubmission) {
  return [
    submission.name,
    submission.email,
    submission.whatsapp,
    submission.categories,
    submission.otherCategory,
    submission.wtfIdea,
    submission.currentProject,
    submission.youtubeLink,
    submission.interests,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatDateTime(date: string) {
  return dateTimeFormatter.format(new Date(date));
}

function formatShortDate(date: string) {
  return shortDateFormatter.format(new Date(date));
}

function getSafeExternalUrl(url?: string) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);

    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:"
      ? parsedUrl.toString()
      : null;
  } catch {
    return null;
  }
}

function getYouTubeEmbedUrl(url?: string) {
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    let videoId: string | null = null;

    if (parsedUrl.hostname === "youtu.be") {
      videoId = parsedUrl.pathname.split("/").filter(Boolean)[0] ?? null;
    } else if (parsedUrl.hostname.includes("youtube.com")) {
      if (parsedUrl.pathname === "/watch") {
        videoId = parsedUrl.searchParams.get("v");
      } else if (parsedUrl.pathname.startsWith("/shorts/")) {
        videoId = parsedUrl.pathname.split("/")[2] ?? null;
      } else if (parsedUrl.pathname.startsWith("/embed/")) {
        videoId = parsedUrl.pathname.split("/")[2] ?? null;
      }
    }

    if (!videoId) {
      return null;
    }

    const embedUrl = new URL("https://www.youtube.com/embed/" + videoId);
    const startAt = parsedUrl.searchParams.get("t");

    if (startAt) {
      const seconds = Number.parseInt(startAt, 10);

      if (!Number.isNaN(seconds) && seconds > 0) {
        embedUrl.searchParams.set("start", String(seconds));
      }
    }

    return embedUrl.toString();
  } catch (error) {
    console.error("YouTube URL parse error:", error);
    return null;
  }
}
