import path from "node:path";
import crypto from "node:crypto";
import { expandGlob } from "../utils/glob.js";
import { fileExists, readTextFile, fileStat } from "../utils/fs.js";
import { ScanCache } from "../context/scan-cache.js";

export enum FileType {
  CODE = "code",
  MARKDOWN = "markdown",
  DOCUMENT = "document",
  PDF = "pdf",
  SPREADSHEET = "spreadsheet",
  CSV = "csv",
  JSON = "json",
  YAML = "yaml",
  XML = "xml",
  CONFIG = "config",
  IMAGE = "image",
  ARTIFACT = "artifact",
  LOG = "log",
  DATA = "data",
  NOTE = "note",
  EXTERNAL_SUMMARY = "external_summary",
  UNKNOWN = "unknown",
}

const TYPE_EXTENSIONS: Record<FileType, string[]> = {
  [FileType.CODE]: [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".py",
    ".go",
    ".rs",
    ".rb",
    ".java",
    ".kt",
    ".swift",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cs",
    ".php",
    ".r",
    ".scala",
    ".zig",
    ".ex",
    ".exs",
    ".hs",
    ".ml",
    ".mli",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".ps1",
    ".sql",
    ".graphql",
    ".gql",
    ".proto",
  ],
  [FileType.MARKDOWN]: [".md", ".mdx", ".markdown"],
  [FileType.DOCUMENT]: [".txt", ".rst", ".adoc", ".asciidoc", ".tex"],
  [FileType.PDF]: [".pdf"],
  [FileType.SPREADSHEET]: [".xls", ".xlsx", ".ods", ".numbers"],
  [FileType.CSV]: [".csv", ".tsv"],
  [FileType.JSON]: [".json", ".jsonc", ".json5"],
  [FileType.YAML]: [".yaml", ".yml"],
  [FileType.XML]: [".xml", ".xsd", ".xslt", ".xsl", ".svg"],
  [FileType.CONFIG]: [
    ".env",
    ".env.*",
    ".cfg",
    ".conf",
    ".ini",
    ".toml",
    ".editorconfig",
    ".gitignore",
    ".dockerignore",
    "Makefile",
    "Dockerfile",
  ],
  [FileType.IMAGE]: [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".webp",
    ".ico",
    ".tiff",
    ".tif",
    ".avif",
  ],
  [FileType.ARTIFACT]: [".log.json", ".result.json", ".report.md", ".summary.md"],
  [FileType.LOG]: [".log", ".out", ".err"],
  [FileType.DATA]: [".db", ".sqlite", ".parquet", ".arrow", ".h5", ".hdf5", ".feather"],
  [FileType.NOTE]: [".md", ".txt", ".org", ".roam"],
  [FileType.EXTERNAL_SUMMARY]: [],
  [FileType.UNKNOWN]: [],
};

const TYPE_PATTERNS: Record<string, FileType> = {
  ".json": FileType.JSON,
  ".jsonc": FileType.JSON,
  ".json5": FileType.JSON,
  ".yaml": FileType.YAML,
  ".yml": FileType.YAML,
  ".xml": FileType.XML,
  ".xsd": FileType.XML,
  ".xslt": FileType.XML,
  ".xls": FileType.SPREADSHEET,
  ".xlsx": FileType.SPREADSHEET,
  ".ods": FileType.SPREADSHEET,
  ".csv": FileType.CSV,
  ".tsv": FileType.CSV,
  ".md": FileType.MARKDOWN,
  ".mdx": FileType.MARKDOWN,
  ".markdown": FileType.MARKDOWN,
  ".txt": FileType.DOCUMENT,
  ".rst": FileType.DOCUMENT,
  ".tex": FileType.DOCUMENT,
  ".pdf": FileType.PDF,
  ".png": FileType.IMAGE,
  ".jpg": FileType.IMAGE,
  ".jpeg": FileType.IMAGE,
  ".gif": FileType.IMAGE,
  ".webp": FileType.IMAGE,
  ".ico": FileType.IMAGE,
  ".bmp": FileType.IMAGE,
  ".tiff": FileType.IMAGE,
  ".log": FileType.LOG,
};

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".flowtask",
  ".codegraph",
  ".turbo",
  ".cache",
  ".nyc_output",
  ".svn",
  ".hg",
  ".idea",
  ".vscode",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  "target",
  "bin",
  "obj",
]);

const DEFAULT_INCLUDE = ["**/*"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/.flowtask/**",
  "**/.codegraph/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/vendor/**",
  "**/.venv/**",
  "**/venv/**",
  "**/__pycache__/**",
  "**/.pytest_cache/**",
  "**/target/**",
  "**/*.min.*",
  "**/*.bundle.*",
  "**/*.chunk.*",
];

const MAX_DEFAULT_FILE_SIZE = 1_048_576;
const MAX_DEFAULT_TOTAL_CHARS = 50_000;
const MAX_DEFAULT_FILES_PER_TYPE = 20;
const MAX_DEFAULT_TOTAL_FILES = 500;
const CHECKSUM_SAMPLE_CHARS = 4096;
const MAX_SUMMARY_LENGTH = 200;
const PER_FILE_CONTENT_CACHE_SIZE = 500;

export interface FileFingerprint {
  mtimeMs: number;
  size: number;
}

export interface CachedFileContent {
  content: string;
  lines: number;
  summary: string;
  keywords: string[];
  checksum: string;
  fingerprint: FileFingerprint;
}

export interface ScannerConfig {
  includePatterns?: string[];
  excludePatterns?: string[];
  maxFileSize?: number;
  maxTotalChars?: number;
  maxFilesPerType?: number;
  maxTotalFiles?: number;
  cacheDir?: string;
  useCache?: boolean;
  maxSummaryLength?: number;
}

export interface ScanItem {
  filePath: string;
  relativePath: string;
  type: FileType;
  size: number;
  lines: number;
  summary: string;
  keywords: string[];
  checksum: string;
  isNew: boolean;
  isModified: boolean;
}

export interface ScanItemPrevious {
  relativePath: string;
  size: number;
  checksum: string;
}

export interface CompactContext {
  items: ScanItem[];
  summary: string;
  tokenEstimate: number;
  totalFiles: number;
  totalSize: number;
  scannedAt: string;
  categories: Record<string, number>;
}

export interface IncrementalResult {
  result: CompactContext;
  changes: ScanItem[];
  added: number;
  modified: number;
  removed: number;
}

export function detectFileType(filePath: string): FileType {
  const base = path.basename(filePath);
  const lower = base.toLowerCase();

  if (lower === "makefile" || lower === "dockerfile") return FileType.CONFIG;
  if (lower.startsWith(".env")) return FileType.CONFIG;
  if (lower === ".gitignore" || lower === ".dockerignore" || lower === ".editorconfig") {
    return FileType.CONFIG;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mapped = TYPE_PATTERNS[ext];
  if (mapped) return mapped;

  if (ext === ".toml" || ext === ".ini") return FileType.CONFIG;
  if (ext === ".org" || ext === ".roam") return FileType.NOTE;

  if (TYPE_EXTENSIONS[FileType.CODE].includes(ext)) return FileType.CODE;

  return FileType.UNKNOWN;
}

function isExcluded(relativePath: string, extraExclude: Set<string>): boolean {
  const parts = relativePath.split(path.sep);
  return parts.some((p) => EXCLUDED_DIRS.has(p) || extraExclude.has(p));
}

export function computeChecksum(filePath: string, content: string): string {
  const sample = content.slice(0, CHECKSUM_SAMPLE_CHARS);
  return crypto.createHash("sha256").update(sample).digest("hex").slice(0, 12);
}

export function countLines(content: string): number {
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") count++;
  }
  if (content.length > 0 && !content.endsWith("\n")) count++;
  return count;
}

function makeSummary(filePath: string, type: FileType, content: string): string {
  if (type === FileType.IMAGE || type === FileType.PDF || type === FileType.SPREADSHEET) {
    return `[${type}] ${path.basename(filePath)} (${content.length}B)`;
  }
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const meaningful = lines.slice(0, 5);
  for (let i = 0; i < meaningful.length; i++) {
    const line = meaningful[i]!.trim();
    if (line.startsWith("#") || line.startsWith("//") || line.startsWith("/*")) {
      meaningful[i] = line.replace(/^[#\/\s*]+/, "").trim();
    }
  }
  const cleaned = meaningful
    .map((l) => l.replace(/["'`]/g, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 3);
  if (cleaned.length === 0) return path.basename(filePath);
  const joined = cleaned.join(" | ");
  return joined.length > 120 ? joined.slice(0, 117) + "..." : joined;
}

export function extractKeywords(content: string, maxKeywords = 10): string[] {
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxKeywords);
  return sorted.map(([w]) => w);
}

export function estimateTokens(text: string): number {
  const charCount = text.length;
  return Math.ceil(charCount / 4);
}

export function formatCompactContext(ctx: CompactContext): string {
  const parts: string[] = [];
  parts.push(`# Scan Summary`);
  parts.push(`- Total files: ${ctx.totalFiles}`);
  parts.push(`- Total size: ${formatSize(ctx.totalSize)}`);
  parts.push(`- Estimated tokens: ${ctx.tokenEstimate}`);
  parts.push(`- Scanned at: ${ctx.scannedAt}`);
  parts.push("");

  const categories = Object.entries(ctx.categories).filter(([, count]) => count > 0);
  if (categories.length > 0) {
    parts.push("## Categories");
    for (const [cat, count] of categories) {
      parts.push(`- ${cat}: ${count} file(s)`);
    }
    parts.push("");
  }

  if (ctx.items.length > 0) {
    parts.push("## Files");
    const grouped = new Map<string, ScanItem[]>();
    for (const item of ctx.items) {
      const key = item.type;
      const group = grouped.get(key) ?? [];
      group.push(item);
      grouped.set(key, group);
    }
    for (const [type, items] of [...grouped.entries()].sort()) {
      parts.push(`\n### ${type} (${items.length})`);
      for (const item of items) {
        const markers: string[] = [];
        if (item.isNew) markers.push("NEW");
        if (item.isModified) markers.push("MODIFIED");
        const markerStr = markers.length > 0 ? ` [${markers.join(",")}]` : "";
        parts.push(
          `- ${item.relativePath} (${formatSize(item.size)}, ${item.lines} lines)${markerStr}`,
        );
        if (item.summary.length > 0) {
          parts.push(`  → ${item.summary}`);
        }
      }
    }
  }

  return parts.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export class WorkspaceScanner {
  private includePatterns: string[];
  private excludePatterns: string[];
  private maxFileSize: number;
  private maxTotalChars: number;
  private maxFilesPerType: number;
  private maxTotalFiles: number;
  private maxSummaryLength: number;
  private cache: ScanCache | null;
  private contentCache: Map<string, CachedFileContent>;

  constructor(config?: ScannerConfig) {
    this.includePatterns = config?.includePatterns ?? DEFAULT_INCLUDE;
    this.excludePatterns = [...DEFAULT_EXCLUDE, ...(config?.excludePatterns ?? [])];
    this.maxFileSize = config?.maxFileSize ?? MAX_DEFAULT_FILE_SIZE;
    this.maxTotalChars = config?.maxTotalChars ?? MAX_DEFAULT_TOTAL_CHARS;
    this.maxFilesPerType = config?.maxFilesPerType ?? MAX_DEFAULT_FILES_PER_TYPE;
    this.maxTotalFiles = config?.maxTotalFiles ?? MAX_DEFAULT_TOTAL_FILES;
    this.maxSummaryLength = config?.maxSummaryLength ?? MAX_SUMMARY_LENGTH;
    this.cache =
      config?.cacheDir && (config?.useCache ?? true)
        ? new ScanCache({ cacheDir: config.cacheDir, useCache: true })
        : null;
    this.contentCache = new Map();
  }

  async scan(projectRoot: string, prompt?: string): Promise<CompactContext> {
    const cacheKey = this.cacheKey(projectRoot, prompt);
    if (this.cache) {
      const deps = await this.resolveCacheDeps(projectRoot);
      const cached = await this.cache.get<CompactContext>(cacheKey, deps);
      if (cached) return cached;
    }

    const allFiles = await this.discoverFiles(projectRoot);
    const items = await this.scanFiles(projectRoot, allFiles);
    const result = this.buildCompactContext(items, projectRoot);

    if (this.cache) {
      const deps = await this.resolveCacheDeps(projectRoot);
      await this.cache.set(cacheKey, result, deps);
    }

    return result;
  }

  async scanIncremental(
    projectRoot: string,
    previousResult: CompactContext,
    prompt?: string,
  ): Promise<IncrementalResult> {
    const previousMap = new Map<string, { size: number; checksum: string }>();
    for (const item of previousResult.items) {
      previousMap.set(item.relativePath, { size: item.size, checksum: item.checksum });
    }

    const changes: ScanItem[] = [];
    let added = 0;
    let modified = 0;
    let removed = 0;

    const allFiles = await this.discoverFiles(projectRoot);
    const typeCount = new Map<FileType, number>();
    const totalChars = 0;
    const currentItems: ScanItem[] = [];

    for (const filePath of allFiles) {
      if (currentItems.length >= this.maxTotalFiles) break;

      const stat = await fileStat(filePath);
      if (!stat || !stat.isFile()) continue;
      if (stat.size > this.maxFileSize) continue;

      const relativePath = path.relative(projectRoot, filePath);
      const type = detectFileType(filePath);
      const currentTypeCount = typeCount.get(type) ?? 0;
      if (currentTypeCount >= this.maxFilesPerType) continue;
      typeCount.set(type, currentTypeCount + 1);

      const prev = previousMap.get(relativePath);
      if (prev) {
        const sizeUnchanged = prev.size === stat.size;
        const scanItem = await this.scanSingleFile(projectRoot, filePath, stat, type, totalChars);
        if (!scanItem) continue;

        if (sizeUnchanged && scanItem.checksum === prev.checksum) {
          scanItem.isModified = false;
          currentItems.push(scanItem);
          continue;
        }

        scanItem.isModified = true;
        modified++;
        changes.push(scanItem);
        currentItems.push(scanItem);
      } else {
        added++;
        const scanItem = await this.scanSingleFile(projectRoot, filePath, stat, type, totalChars);
        if (!scanItem) continue;
        scanItem.isNew = true;
        changes.push(scanItem);
        currentItems.push(scanItem);
      }
    }

    const currentPaths = new Set(currentItems.map((i) => i.relativePath));
    for (const relPath of previousMap.keys()) {
      if (!currentPaths.has(relPath)) removed++;
    }

    const result = this.buildCompactContext(currentItems, projectRoot);

    if (this.cache) {
      const deps = await this.resolveCacheDeps(projectRoot);
      await this.cache.set(this.cacheKey(projectRoot, prompt), result, deps);
    }

    return { result, changes, added, modified, removed };
  }

  invalidateContentCache(): void {
    this.contentCache.clear();
  }

  private async scanSingleFile(
    projectRoot: string,
    filePath: string,
    stat: { size: number; mtimeMs: number },
    type: FileType,
    currentTotalChars: number,
  ): Promise<ScanItem | null> {
    const relativePath = path.relative(projectRoot, filePath);
    const cached = this.contentCache.get(filePath);
    if (cached && cached.fingerprint.mtimeMs === stat.mtimeMs) {
      return {
        filePath,
        relativePath,
        type,
        size: stat.size,
        lines: cached.lines,
        summary: cached.summary,
        keywords: cached.keywords,
        checksum: cached.checksum,
        isNew: false,
        isModified: false,
      };
    }

    let content = "";
    let lines = 0;
    let summary = "";
    let keywords: string[] = [];

    const readContent =
      type !== FileType.IMAGE &&
      type !== FileType.PDF &&
      type !== FileType.SPREADSHEET &&
      type !== FileType.DATA;

    if (readContent) {
      try {
        content = await readTextFile(filePath);
        lines = countLines(content);

        if (currentTotalChars + content.length > this.maxTotalChars) {
          const remaining = this.maxTotalChars - currentTotalChars;
          content = content.slice(0, Math.max(remaining, 0));
          content += "\n... (truncated)";
        }

        summary = makeSummary(filePath, type, content);
        if (summary.length > this.maxSummaryLength) {
          summary = summary.slice(0, this.maxSummaryLength - 3) + "...";
        }
        if (type === FileType.CODE || type === FileType.MARKDOWN || type === FileType.DOCUMENT) {
          keywords = extractKeywords(content);
        }
      } catch {
        content = "";
        lines = 0;
        summary = `[unreadable] ${path.basename(filePath)}`;
      }
    } else {
      summary = `[${type}] ${path.basename(filePath)} (${formatSize(stat.size)})`;
    }

    const checksum =
      content.length > 0
        ? computeChecksum(filePath, content)
        : crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 12);

    const scanItem: ScanItem = {
      filePath,
      relativePath,
      type,
      size: stat.size,
      lines,
      summary,
      keywords,
      checksum,
      isNew: false,
      isModified: false,
    };

    if (this.contentCache.size < PER_FILE_CONTENT_CACHE_SIZE) {
      this.contentCache.set(filePath, {
        content,
        lines,
        summary,
        keywords,
        checksum,
        fingerprint: { mtimeMs: stat.mtimeMs, size: stat.size },
      });
    }

    return scanItem;
  }

  private cacheKey(projectRoot: string, prompt?: string): string {
    const input = `${projectRoot}|${prompt ?? ""}`;
    return `workspace-scan-${crypto.createHash("sha256").update(input).digest("hex").slice(0, 16)}`;
  }

  private async resolveCacheDeps(projectRoot: string): Promise<string[]> {
    const deps: string[] = [];
    const gitHead = path.join(projectRoot, ".git", "HEAD");
    if (await fileExists(gitHead)) deps.push(gitHead);
    const gitIndex = path.join(projectRoot, ".git", "index");
    if (await fileExists(gitIndex)) deps.push(gitIndex);
    return deps;
  }

  private async discoverFiles(projectRoot: string): Promise<string[]> {
    const allFiles: string[] = [];
    for (const pattern of this.includePatterns) {
      const files = await expandGlob(pattern, {
        cwd: projectRoot,
        absolute: true,
        onlyFiles: true,
      });
      for (const f of files) {
        if (!allFiles.includes(f)) allFiles.push(f);
      }
    }

    const extraExclude = new Set<string>();
    for (const p of this.excludePatterns) {
      const cleaned = p
        .replace(/\*\*\/$/, "")
        .replace(/\/\*\*$/, "")
        .replace(/\*\*/g, "");
      if (cleaned.length > 0) {
        const base = path.basename(cleaned) || cleaned;
        if (base.length > 0 && !base.includes("*")) extraExclude.add(base);
      }
    }

    return allFiles.filter((f) => {
      const rel = path.relative(projectRoot, f);
      if (!rel || rel.startsWith("..")) return false;
      if (isExcluded(rel, extraExclude)) return false;
      return true;
    });
  }

  private async scanFiles(projectRoot: string, filePaths: string[]): Promise<ScanItem[]> {
    const items: ScanItem[] = [];
    const typeCount = new Map<FileType, number>();
    let totalChars = 0;

    for (const filePath of filePaths) {
      if (items.length >= this.maxTotalFiles) break;

      const stat = await fileStat(filePath);
      if (!stat || !stat.isFile()) continue;
      if (stat.size > this.maxFileSize) continue;

      const type = detectFileType(filePath);
      const currentTypeCount = typeCount.get(type) ?? 0;
      if (currentTypeCount >= this.maxFilesPerType) continue;
      typeCount.set(type, currentTypeCount + 1);

      const item = await this.scanSingleFile(
        projectRoot,
        filePath,
        { size: stat.size, mtimeMs: stat.mtimeMs },
        type,
        totalChars,
      );
      if (!item) continue;
      totalChars += Math.max(item.summary.length, 100);
      items.push(item);
    }

    return items;
  }

  private buildCompactContext(items: ScanItem[], _projectRoot: string): CompactContext {
    const categories: Record<string, number> = {};
    for (const item of items) {
      categories[item.type] = (categories[item.type] ?? 0) + 1;
    }

    const summary = formatCompactContext({
      items,
      summary: "",
      tokenEstimate: 0,
      totalFiles: 0,
      totalSize: 0,
      scannedAt: "",
      categories,
    });

    const totalSize = items.reduce((acc, i) => acc + i.size, 0);
    const scannedAt = new Date().toISOString();

    return {
      items,
      summary,
      tokenEstimate: estimateTokens(summary),
      totalFiles: items.length,
      totalSize,
      scannedAt,
      categories,
    };
  }
}
