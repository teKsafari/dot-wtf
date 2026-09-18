import { createHash } from "node:crypto";
import {
  access,
  chmod,
  mkdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

const EXPORT_SCHEMA_VERSION = "cwru-wtf.tally-migration-export.v1";
const JSON_FILE_NAME = "tally-submissions.json";
const CSV_FILE_NAME = "tally-submissions.csv";
const MANIFEST_FILE_NAME = "tally-export-manifest.json";

type ReviewStatus = "pending" | "approved" | "waitlist";

interface CliOptions {
  envFile: string | null;
  help: boolean;
  outputDir: string | null;
}

interface SourceSubmission {
  id: number;
  name: string;
  email: string;
  categories: string;
  other_category: string | null;
  wtf_idea: string;
  current_project: string;
  youtube_link: string;
  whatsapp: string | null;
  interests: string | null;
  is_approved: boolean | null;
  archived_at: null;
  created_at: string;
  updated_at: string;
}

interface ExportSubmission {
  originalId: number;
  name: string;
  email: string;
  whatsapp: string | null;
  categories: string[];
  categoriesRaw: string;
  otherCategory: string | null;
  wtfIdea: string;
  currentProject: string;
  youtubeLink: string;
  legacyInterests: string | null;
  originalIsApproved: boolean | null;
  reviewStatus: ReviewStatus;
  archivedAt: null;
  createdAt: string;
  updatedAt: string;
}

class SafeCliError extends Error {}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

function printUsage() {
  console.log(`Usage:
  pnpm exec tsx scripts/export-tally-migration.ts --output-dir <path> [--env-file <path>]

Options:
  --output-dir <path>  Required. New export files are written outside the repository.
  --env-file <path>    Optional. Load DATABASE_URL from this file.
  --help               Show this help message.`);
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    envFile: null,
    help: false,
    outputDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--output-dir" || argument === "--env-file") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new SafeCliError(`${argument} requires a path.`);
      }

      if (argument === "--output-dir") {
        options.outputDir = value;
      } else {
        options.envFile = value;
      }

      index += 1;
      continue;
    }

    throw new SafeCliError(`Unknown argument: ${argument}`);
  }

  return options;
}

function isPathInside(parentPath: string, childPath: string) {
  const relativePath = relative(parentPath, childPath);

  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`))
  );
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveThroughExistingAncestor(path: string) {
  let existingAncestor = path;

  while (!(await pathExists(existingAncestor))) {
    const parent = dirname(existingAncestor);

    if (parent === existingAncestor) {
      break;
    }

    existingAncestor = parent;
  }

  const realAncestor = await realpath(existingAncestor);
  return resolve(realAncestor, relative(existingAncestor, path));
}

async function resolveSafeOutputDirectory(value: string) {
  const absoluteOutputDirectory = resolve(value);
  const [realRepositoryRoot, resolvedOutputDirectory] = await Promise.all([
    realpath(repositoryRoot),
    resolveThroughExistingAncestor(absoluteOutputDirectory),
  ]);

  if (isPathInside(realRepositoryRoot, resolvedOutputDirectory)) {
    throw new SafeCliError(
      "The output directory must be outside the repository so applicant data cannot be tracked.",
    );
  }

  return resolvedOutputDirectory;
}

function parseCategories(rawCategories: string) {
  try {
    const parsedCategories: unknown = JSON.parse(rawCategories);

    if (
      !Array.isArray(parsedCategories) ||
      parsedCategories.some((category) => typeof category !== "string")
    ) {
      return null;
    }

    return parsedCategories;
  } catch {
    return null;
  }
}

function getReviewStatus(isApproved: boolean | null): ReviewStatus {
  if (isApproved === true) return "approved";
  if (isApproved === false) return "waitlist";
  return "pending";
}

function mapSubmissions(sourceRows: SourceSubmission[]) {
  let invalidCategoryRows = 0;

  const submissions = sourceRows.flatMap<ExportSubmission>((row) => {
    const categories = parseCategories(row.categories);

    if (!categories) {
      invalidCategoryRows += 1;
      return [];
    }

    return [
      {
        originalId: row.id,
        name: row.name,
        email: row.email,
        whatsapp: row.whatsapp,
        categories,
        categoriesRaw: row.categories,
        otherCategory: row.other_category,
        wtfIdea: row.wtf_idea,
        currentProject: row.current_project,
        youtubeLink: row.youtube_link,
        legacyInterests: row.interests,
        originalIsApproved: row.is_approved,
        reviewStatus: getReviewStatus(row.is_approved),
        archivedAt: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    ];
  });

  if (invalidCategoryRows > 0) {
    throw new SafeCliError(
      `Export stopped: ${invalidCategoryRows} active submission row(s) contain invalid category JSON. No export files were written.`,
    );
  }

  return submissions;
}

function escapeCsvCell(value: string | number | boolean | null) {
  const serializedValue = value === null ? "null" : String(value);
  return `"${serializedValue.replaceAll('"', '""')}"`;
}

function makeCsv(submissions: ExportSubmission[]) {
  const headers = [
    "legacy_submission_id",
    "name",
    "email",
    "whatsapp",
    "categories",
    "categories_json_raw",
    "other_category",
    "wtf_idea",
    "current_project",
    "youtube_link",
    "legacy_interests",
    "original_is_approved",
    "review_status",
    "archived_at",
    "created_at",
    "updated_at",
  ];

  const rows = submissions.map((submission) => [
    submission.originalId,
    submission.name,
    submission.email,
    submission.whatsapp,
    submission.categories.join("; "),
    submission.categoriesRaw,
    submission.otherCategory,
    submission.wtfIdea,
    submission.currentProject,
    submission.youtubeLink,
    submission.legacyInterests,
    submission.originalIsApproved,
    submission.reviewStatus,
    submission.archivedAt,
    submission.createdAt,
    submission.updatedAt,
  ]);

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}

function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function writePrivateFile(path: string, content: string) {
  await writeFile(path, content, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

function getStatusCounts(submissions: ExportSubmission[]) {
  return submissions.reduce(
    (counts, submission) => {
      counts[submission.reviewStatus] += 1;
      return counts;
    },
    { approved: 0, pending: 0, waitlist: 0 },
  );
}

async function readActiveSubmissions(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    connect_timeout: 10,
    idle_timeout: 5,
    max: 1,
    prepare: false,
    onnotice: () => undefined,
  });

  try {
    return await sql.begin(async (transaction) => {
      await transaction.unsafe("SET TRANSACTION READ ONLY");

      return transaction.unsafe<SourceSubmission[]>(`
        SELECT
          id,
          name,
          email,
          categories,
          other_category,
          wtf_idea,
          current_project,
          youtube_link,
          whatsapp,
          interests,
          is_approved,
          archived_at,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM submissions
        WHERE archived_at IS NULL
        ORDER BY id ASC
      `);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (!options.outputDir) {
    throw new SafeCliError("--output-dir is required.");
  }

  const outputDirectory = await resolveSafeOutputDirectory(options.outputDir);
  const envFile = options.envFile
    ? resolve(options.envFile)
    : resolve(repositoryRoot, ".env");

  if (options.envFile && !isAbsolute(options.envFile)) {
    console.log(`Using environment file resolved from the current directory.`);
  }

  const envResult = loadEnv({
    path: envFile,
    override: Boolean(options.envFile),
    quiet: true,
  });

  if (options.envFile && envResult.error) {
    throw new SafeCliError("The file provided with --env-file could not be loaded.");
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new SafeCliError(
      "DATABASE_URL is missing. Set it in the environment or provide --env-file.",
    );
  }

  await mkdir(outputDirectory, { mode: 0o700, recursive: true });

  const jsonPath = resolve(outputDirectory, JSON_FILE_NAME);
  const csvPath = resolve(outputDirectory, CSV_FILE_NAME);
  const manifestPath = resolve(outputDirectory, MANIFEST_FILE_NAME);
  const existingOutputFiles = (
    await Promise.all(
      [jsonPath, csvPath, manifestPath].map((path) => pathExists(path)),
    )
  ).filter(Boolean).length;

  if (existingOutputFiles > 0) {
    throw new SafeCliError(
      "Export stopped because an output file already exists. Choose a new output directory; existing files were not overwritten.",
    );
  }

  const sourceRows = await readActiveSubmissions(databaseUrl);
  const submissions = mapSubmissions(sourceRows);
  const generatedAt = new Date().toISOString();
  const statusCounts = getStatusCounts(submissions);
  const recordSetSha256 = sha256(JSON.stringify(submissions));
  const json = `${JSON.stringify(
    {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generatedAt,
      selection: { archivedAt: null },
      submissions,
    },
    null,
    2,
  )}\n`;
  const csv = makeCsv(submissions);
  const jsonSha256 = sha256(json);
  const csvSha256 = sha256(csv);
  const manifest = `${JSON.stringify(
    {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      generatedAt,
      selection: {
        predicate: "archived_at IS NULL",
        order: "id ASC",
      },
      recordCount: submissions.length,
      reviewStatusCounts: statusCounts,
      recordSetSha256,
      files: {
        json: {
          name: JSON_FILE_NAME,
          bytes: Buffer.byteLength(json, "utf8"),
          sha256: jsonSha256,
        },
        csv: {
          name: CSV_FILE_NAME,
          bytes: Buffer.byteLength(csv, "utf8"),
          sha256: csvSha256,
        },
      },
    },
    null,
    2,
  )}\n`;

  try {
    await writePrivateFile(jsonPath, json);
    await writePrivateFile(csvPath, csv);
    await writePrivateFile(manifestPath, manifest);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new SafeCliError(
        "Export stopped because an output file already exists. Choose a new output directory; existing files were not overwritten.",
      );
    }

    throw error;
  }

  console.log("Tally migration export complete.");
  console.log(`Records: ${submissions.length}`);
  console.log(
    `Statuses: ${statusCounts.pending} pending, ${statusCounts.approved} approved, ${statusCounts.waitlist} waitlist`,
  );
  console.log(`Record-set SHA-256: ${recordSetSha256}`);
  console.log(`Manifest: ${MANIFEST_FILE_NAME}`);
  console.log("No database rows were modified and no data was uploaded.");
}

main().catch((error: unknown) => {
  if (error instanceof SafeCliError) {
    console.error(error.message);
  } else if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    console.error(
      `Export failed with code ${error.code}. Applicant data was not logged.`,
    );
  } else {
    console.error("Export failed. Applicant data was not logged.");
  }

  process.exitCode = 1;
});
