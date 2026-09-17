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
  ArrowUpRight,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Search,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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

type SubmissionFilter = "all" | "pending" | "approved" | "rejected";

const PAGE_SIZE = 12;

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "America/New_York",
});
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "America/New_York",
});

const statusCopy = {
  approved: {
    dotClassName: "bg-success",
    textClassName: "text-success",
    label: "Approved",
  },
  pending: {
    dotClassName: "bg-foreground/40",
    textClassName: "text-muted-foreground",
    label: "Pending",
  },
  rejected: {
    dotClassName: "bg-destructive",
    textClassName: "text-destructive",
    label: "Rejected",
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
  const [pendingDecision, setPendingDecision] = useState<{
    submissionId: number;
    isApproved: boolean;
  } | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const queueFocusRestoreIdRef = useRef<number | null>(null);
  const pageFocusRequestedRef = useRef(false);
  const deferredQuery = useDeferredValue(search.trim());
  const normalizedSearch = deferredQuery.toLowerCase();

  const stats = useMemo(() => getSubmissionStats(submissions), [submissions]);
  const filterOptions = [
    { id: "pending", label: "Pending", count: stats.pending },
    { id: "all", label: "All", count: stats.total },
    { id: "approved", label: "Approved", count: stats.approved },
    { id: "rejected", label: "Rejected", count: stats.rejected },
  ] as const satisfies ReadonlyArray<{
    id: SubmissionFilter;
    label: string;
    count: number;
  }>;

  const filteredSubmissions = useMemo(
    () =>
      submissions.filter((submission) => {
        if (filter === "pending" && submission.isApproved !== null) {
          return false;
        }

        if (filter === "approved" && submission.isApproved !== true) {
          return false;
        }

        if (filter === "rejected" && submission.isApproved !== false) {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        return buildSearchBlob(submission).includes(normalizedSearch);
      }),
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
  const nextPendingSubmission = useMemo(
    () =>
      submissions.find(
        (submission) =>
          submission.isApproved === null &&
          submission.id !== selectedSubmissionId,
      ) ?? null,
    [selectedSubmissionId, submissions],
  );

  useEffect(() => {
    if (
      selectedSubmissionId !== null &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      const frameId = window.requestAnimationFrame(() => {
        detailHeadingRef.current?.focus();
      });

      return () => window.cancelAnimationFrame(frameId);
    }

    const rowId = queueFocusRestoreIdRef.current;

    if (selectedSubmissionId === null && rowId !== null) {
      const frameId = window.requestAnimationFrame(() => {
        document.getElementById("submission-row-" + rowId)?.focus();
        queueFocusRestoreIdRef.current = null;
      });

      return () => window.cancelAnimationFrame(frameId);
    }
  }, [selectedSubmissionId]);

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

  const refreshSubmissions = async () => {
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
      setSelectedSubmissionId((currentId) =>
        currentId !== null &&
        refreshedSubmissions.some((submission) => submission.id === currentId)
          ? currentId
          : null,
      );
      toast.success("Application queue refreshed.");
    } catch (error) {
      console.error("Refresh error:", error);
      toast.error(
        "Could not refresh the queue. Check your connection and try again.",
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const updateSubmissionStatus = async (
    submissionId: number,
    isApproved: boolean,
  ) => {
    setPendingDecision({ submissionId, isApproved });

    try {
      const response = await fetch("/api/admin/submissions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: submissionId, isApproved }),
      });

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
      setPageIndex(0);

      toast.success(
        "Application " + (isApproved ? "approved" : "rejected") + ".",
      );
    } catch (error) {
      console.error("Update error:", error);
      toast.error(
        "Could not save this decision. Check your connection and try again.",
      );
    } finally {
      setPendingDecision(null);
    }
  };

  const reviewNextPending = () => {
    if (!nextPendingSubmission) {
      return;
    }

    setFilter("pending");
    setSearch("");
    setPageIndex(0);
    setSelectedSubmissionId(nextPendingSubmission.id);
  };

  const returnToQueue = () => {
    queueFocusRestoreIdRef.current = selectedSubmissionId;
    setSelectedSubmissionId(null);
  };

  const changePage = (nextPage: number) => {
    pageFocusRequestedRef.current = true;
    setPageIndex(nextPage);
    setSelectedSubmissionId(null);
  };

  const hasSelectedSubmission = selectedSubmission !== null;
  const activeDecision =
    pendingDecision?.submissionId === selectedSubmissionId
      ? pendingDecision.isApproved
      : null;

  return (
    <div className="min-h-[100svh] bg-background text-foreground">
      <a
        href="#admin-main"
        className="focus-ring sr-only z-50 rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:fixed focus:left-4 focus:top-4 focus:not-sr-only"
      >
        Skip to Content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1360px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            aria-label="Back to CWRU.WTF home"
            className="focus-ring inline-flex min-h-11 items-center gap-3 rounded-lg text-foreground transition-colors hover:text-muted-foreground"
          >
            <span
              translate="no"
              className="font-brand text-lg font-semibold text-foreground"
            >
              <Wordmark />
            </span>
            <span aria-hidden="true" className="h-4 w-px bg-border" />
            <span className="font-mono text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Admin
            </span>
          </Link>

          <div className="flex min-w-0 items-center gap-3">
            <div className="hidden min-w-0 max-w-[280px] text-right md:block">
              <p className="truncate text-body-sm font-medium text-foreground">
                {admin.name}
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {admin.email} · {admin.role.replace("_", " ")}
              </p>
            </div>
            <Button
              onClick={() => signOut({ callbackUrl: "/" })}
              variant="outline"
              className="h-10 rounded-xl border-border bg-background px-3 text-foreground hover:bg-muted hover:text-foreground sm:px-4"
              aria-label="Sign out of the admin dashboard"
            >
              <LogOut aria-hidden="true" className="h-4 w-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </Button>
          </div>
        </div>
      </header>

      <main
        id="admin-main"
        className="mx-auto w-full max-w-[1360px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
      >
        <section
          aria-labelledby="applications-heading"
          className="flex items-baseline justify-between gap-4"
        >
          <h1
            id="applications-heading"
            className="font-brand text-2xl font-semibold tracking-[-0.02em] text-foreground"
          >
            Applications
            <span className="ml-3 font-mono text-body-sm font-normal tabular-nums text-muted-foreground">
              {stats.pending === 0
                ? "inbox clear"
                : numberFormatter.format(stats.pending) + " to review"}
            </span>
          </h1>

          <button
            type="button"
            onClick={refreshSubmissions}
            disabled={isRefreshing || pendingDecision !== null}
            className="focus-ring -mr-2 inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-body-sm text-muted-foreground transition-colors duration-150 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {isRefreshing ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
              />
            ) : (
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {isRefreshing ? "Refreshing…" : "Refresh"}
            </span>
          </button>
        </section>

        <section
          aria-label="Application review workspace"
          className="mt-5 border-t border-border lg:flex lg:h-[calc(100svh-11.5rem)] lg:min-h-[520px] lg:flex-col"
        >
          <div
            className={cn(
              "flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between",
              hasSelectedSubmission && "hidden lg:flex",
            )}
          >
            <div
              className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1"
              role="group"
              aria-label="Filter applications by status"
            >
              {filterOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectFilter(option.id)}
                  aria-pressed={filter === option.id}
                  className={cn(
                    "focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-body-sm transition-colors duration-150",
                    filter === option.id
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                  <span className="font-mono text-xs tabular-nums opacity-60">
                    {numberFormatter.format(option.count)}
                  </span>
                </button>
              ))}
            </div>

            <div className="relative w-full min-w-0 sm:max-w-[260px]">
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
                placeholder="Search…"
                className="h-8 rounded-md border-transparent bg-muted px-9 py-0 text-body-sm"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => updateSearch("")}
                  aria-label="Clear application search"
                  className="focus-ring absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:text-foreground"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          {/* The visible count moved into the pagination line, so the queue
              still announces itself to screen readers on filter and search. */}
          <p className="sr-only" aria-live="polite">
            {numberFormatter.format(filteredSubmissions.length)}{" "}
            {filteredSubmissions.length === 1 ? "application" : "applications"}
          </p>

          <div className="lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.5fr)] lg:border-t lg:border-border">
            <h2 className="sr-only">Application queue</h2>
            <div
              className={cn(
                "min-h-0 flex-col",
                hasSelectedSubmission ? "hidden lg:flex" : "flex",
              )}
            >
              {visibleSubmissions.length === 0 ? (
                <QueueEmptyState
                  hasNarrowedView={Boolean(deferredQuery) || filter !== "all"}
                  onReset={resetView}
                />
              ) : (
                <ul className="min-h-0 flex-1 divide-y divide-border/60 lg:overflow-y-auto">
                  {visibleSubmissions.map((submission) => (
                    <li key={submission.id}>
                      <SubmissionRow
                        isSelected={selectedSubmissionId === submission.id}
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
            </div>

            <div
              className={cn(
                "min-h-0 lg:flex lg:border-l lg:border-border",
                hasSelectedSubmission ? "flex" : "hidden",
              )}
            >
              {selectedSubmission ? (
                <SubmissionDetail
                  activeDecision={activeDecision}
                  decisionsDisabled={pendingDecision !== null || isRefreshing}
                  headingRef={detailHeadingRef}
                  nextPendingSubmission={nextPendingSubmission}
                  onBack={returnToQueue}
                  onDecision={updateSubmissionStatus}
                  onReviewNext={reviewNextPending}
                  submission={selectedSubmission}
                />
              ) : (
                <DetailPlaceholder />
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function SubmissionRow({
  submission,
  isSelected,
  onSelect,
}: {
  submission: AdminSubmission;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const categories = parseCategories(
    submission.categories,
    submission.otherCategory ?? null,
  );
  const primaryCategory = categories[0];

  const tone = getStatusTone(submission.isApproved);

  return (
    <button
      id={"submission-row-" + submission.id}
      type="button"
      onClick={onSelect}
      aria-current={isSelected ? "true" : undefined}
      // Rows are clicked constantly, so this only transitions colour -- no
      // entrance, no movement. See the animation frequency table in the
      // design-eng skill.
      className={cn(
        "focus-ring w-full px-4 py-3 text-left transition-colors duration-150",
        isSelected ? "bg-muted" : "hover:bg-muted/50",
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 translate-y-[-1px] rounded-full",
            tone.dotClassName,
          )}
        />
        <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-foreground">
          {submission.name}
        </span>
        <span className="sr-only">{tone.label}.</span>
        <time
          dateTime={submission.createdAt}
          className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        >
          {formatShortDate(submission.createdAt)}
        </time>
      </span>

      <span className="mt-1 line-clamp-1 block break-words pl-3.5 text-xs leading-5 text-muted-foreground">
        {primaryCategory ? (
          <span className="text-foreground/70">{primaryCategory} · </span>
        ) : null}
        {submission.wtfIdea || "No idea shared yet."}
      </span>
    </button>
  );
}

function SubmissionDetail({
  submission,
  onBack,
  onDecision,
  activeDecision,
  decisionsDisabled,
  headingRef,
  nextPendingSubmission,
  onReviewNext,
}: {
  submission: AdminSubmission;
  onBack: () => void;
  onDecision: (submissionId: number, isApproved: boolean) => Promise<void>;
  activeDecision: boolean | null;
  decisionsDisabled: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  nextPendingSubmission: AdminSubmission | null;
  onReviewNext: () => void;
}) {
  const categories = parseCategories(
    submission.categories,
    submission.otherCategory ?? null,
  );
  const videoReferenceUrl = getSafeExternalUrl(submission.youtubeLink);
  const youtubeEmbedUrl = getYouTubeEmbedUrl(videoReferenceUrl ?? undefined);
  const headingId = "submission-detail-" + submission.id;
  const isPending = submission.isApproved === null;

  return (
    <article
      aria-labelledby={headingId}
      className="flex min-h-0 w-full scroll-pt-28 scroll-pb-24 flex-col lg:overflow-y-auto"
    >
      <header className="sticky top-16 z-10 border-b border-border bg-background/80 px-5 py-4 backdrop-blur sm:px-6 lg:top-0">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring -ml-1 mb-3 inline-flex min-h-9 items-center gap-1 rounded-lg pr-2 text-body-sm text-muted-foreground transition-colors duration-150 hover:text-foreground lg:hidden"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          Queue
        </button>

        <div className="flex min-w-0 items-baseline gap-3">
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="focus-ring min-w-0 flex-1 break-words rounded font-brand text-xl font-semibold tracking-[-0.02em] text-foreground"
          >
            {submission.name}
          </h2>
          <StatusBadge status={submission.isApproved} />
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          <time dateTime={submission.createdAt}>
            {formatDateTime(submission.createdAt)}
          </time>
        </p>
      </header>

      <div className="flex-1">
        <DetailSection title="WTF idea">
          <p className="break-words whitespace-pre-wrap text-body leading-6 text-foreground">
            {submission.wtfIdea || "No idea shared yet."}
          </p>
        </DetailSection>

        <DetailSection title="Current project">
          <p className="break-words whitespace-pre-wrap text-body-sm text-foreground">
            {submission.currentProject || "No project details shared yet."}
          </p>
        </DetailSection>

        <DetailSection title="Categories">
          <div className="flex flex-wrap gap-2">
            {categories.length > 0 ? (
              categories.map((category) => (
                <Badge
                  key={category}
                  variant="outline"
                  className="break-words border-border bg-transparent px-2 py-0.5 text-xs font-normal text-muted-foreground"
                >
                  {category}
                </Badge>
              ))
            ) : (
              <span className="text-body-sm text-muted-foreground">
                No categories provided.
              </span>
            )}
          </div>

          {submission.interests ? (
            <p className="mt-3 break-words whitespace-pre-wrap text-body-sm text-muted-foreground">
              {submission.interests}
            </p>
          ) : null}
        </DetailSection>

        <DetailSection title="Contact">
          <dl className="grid gap-2 sm:grid-cols-2">
            <ContactDetail label="Email">
              <a
                className="focus-ring rounded break-all text-link hover:underline"
                href={"mailto:" + submission.email}
              >
                {submission.email}
              </a>
            </ContactDetail>

            <ContactDetail label="WhatsApp">
              {submission.whatsapp ? (
                <a
                  className="focus-ring rounded break-all text-link hover:underline"
                  href={"tel:" + submission.whatsapp}
                >
                  {submission.whatsapp}
                </a>
              ) : (
                <span className="text-muted-foreground">Not shared</span>
              )}
            </ContactDetail>
          </dl>
        </DetailSection>

        {videoReferenceUrl ? (
          <DetailSection title="Video" isLast>
            {youtubeEmbedUrl ? (
              <div className="aspect-video overflow-hidden rounded-lg border border-border bg-foreground">
                <iframe
                  src={youtubeEmbedUrl}
                  title={submission.name + " YouTube reference"}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="h-full w-full"
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              </div>
            ) : null}

            <a
              href={videoReferenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "focus-ring inline-flex items-center gap-1 rounded text-body-sm text-link hover:underline",
                youtubeEmbedUrl && "mt-3",
              )}
            >
              Open video
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </DetailSection>
        ) : null}
      </div>

      <footer className="sticky bottom-0 z-10 mt-auto border-t border-border bg-background/80 px-5 py-3 backdrop-blur sm:px-6">
        {isPending ? (
          <div className="flex items-center justify-end gap-2">
            <RejectSubmissionDialog
              activeDecision={activeDecision}
              disabled={decisionsDisabled}
              name={submission.name}
              onReject={() => onDecision(submission.id, false)}
            />
            <Button
              onClick={() => onDecision(submission.id, true)}
              disabled={decisionsDisabled}
              aria-busy={activeDecision === true}
              aria-label={"Approve " + submission.name}
              size="sm"
              className="h-9 px-4 text-body-sm"
            >
              {activeDecision === true ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                />
              ) : (
                <CheckCheck aria-hidden="true" className="h-4 w-4" />
              )}
              {activeDecision === true ? "Approving…" : "Approve"}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-body-sm text-muted-foreground">
              {getStatusTone(submission.isApproved).label}
            </p>
            {nextPendingSubmission ? (
              <Button
                onClick={onReviewNext}
                variant="ghost"
                size="sm"
                className="h-9 text-body-sm"
              >
                Next pending
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        )}
      </footer>
    </article>
  );
}

function RejectSubmissionDialog({
  name,
  disabled,
  activeDecision,
  onReject,
}: {
  name: string;
  disabled: boolean;
  activeDecision: boolean | null;
  onReject: () => Promise<void>;
}) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button
          disabled={disabled}
          aria-busy={activeDecision === false}
          aria-label={"Reject " + name}
          variant="ghost"
          size="sm"
          className="h-9 px-4 text-body-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {activeDecision === false ? (
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <XCircle aria-hidden="true" className="h-4 w-4" />
          )}
          {activeDecision === false ? "Rejecting…" : "Reject"}
        </Button>
      </AlertDialog.Trigger>

      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-foreground/20 duration-150 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="focus-ring fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overscroll-contain rounded-xl border border-border bg-background p-5 shadow-lg ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:duration-150 data-[state=open]:duration-200">
          <AlertDialog.Title className="text-pretty font-brand text-base font-semibold text-foreground">
            Reject {name}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 break-words text-body-sm text-muted-foreground">
            This is recorded immediately and moves them out of the pending
            queue.
          </AlertDialog.Description>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost" size="sm" className="h-9 text-body-sm">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                onClick={() => void onReject()}
                variant="destructive"
                size="sm"
                className="h-9 text-body-sm"
              >
                Reject
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

function StatusBadge({ status }: { status: boolean | null }) {
  const tone = getStatusTone(status);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-body-sm",
        tone.textClassName,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", tone.dotClassName)}
      />
      {tone.label}
    </span>
  );
}

function DetailSection({
  title,
  children,
  isLast = false,
}: {
  title: string;
  children: ReactNode;
  isLast?: boolean;
}) {
  return (
    <section
      className={cn(
        "px-5 py-4 sm:px-6",
        !isLast && "border-b border-border/60",
      )}
    >
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ContactDetail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0 text-body-sm text-foreground">{children}</dd>
    </div>
  );
}

function QueueEmptyState({
  hasNarrowedView,
  onReset,
}: {
  hasNarrowedView: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-body-sm text-muted-foreground">
        {hasNarrowedView ? "Nothing matches." : "No applications yet."}
      </p>
      {hasNarrowedView ? (
        <Button
          type="button"
          onClick={onReset}
          variant="ghost"
          size="sm"
          className="mt-2 text-body-sm"
        >
          Show all
        </Button>
      ) : null}
    </div>
  );
}

function DetailPlaceholder() {
  return (
    <div className="flex min-h-full w-full items-center justify-center px-6 py-16 text-center">
      <p className="text-body-sm text-muted-foreground">
        Select an application to review it.
      </p>
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
      className="flex items-center justify-between gap-3 border-t border-border px-4 py-2"
    >
      <p
        className="font-mono text-xs tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {numberFormatter.format(rangeStart)}–{numberFormatter.format(rangeEnd)}{" "}
        of {numberFormatter.format(total)}
        <span className="sr-only">
          . Page {numberFormatter.format(pageIndex + 1)} of{" "}
          {numberFormatter.format(pageCount)}.
        </span>
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={pageIndex === 0}
          onClick={() => onPageChange(pageIndex - 1)}
          aria-label="Previous page"
          className="size-8"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => onPageChange(pageIndex + 1)}
          aria-label="Next page"
          className="size-8"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}

function getSubmissionStats(submissions: AdminSubmission[]) {
  return submissions.reduce(
    (accumulator, submission) => {
      accumulator.total += 1;

      if (submission.isApproved === null) {
        accumulator.pending += 1;
      } else if (submission.isApproved) {
        accumulator.approved += 1;
      } else {
        accumulator.rejected += 1;
      }

      return accumulator;
    },
    {
      approved: 0,
      pending: 0,
      rejected: 0,
      total: 0,
    },
  );
}

function getStatusTone(status: boolean | null) {
  if (status === true) {
    return statusCopy.approved;
  }

  if (status === false) {
    return statusCopy.rejected;
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
