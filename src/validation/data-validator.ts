import type { ValidationCheck, FailureReason } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import { fileExists, readTextFile } from "../utils/fs.js";

export interface DataValidationInput {
  paths?: string[];
  content?: string;
  executorResult: ExecutorResult;
  projectRoot: string;
  schema?: Record<string, string>;
  rowLimit?: number;
}

const DATA_EXTENSIONS = /\.(csv|json|yaml|yml|xml|xlsx?|parquet|arrow)$/;
const JSON_EXT = /\.json$/;
const CSV_EXT = /\.csv$/;
const YAML_EXT = /\.ya?ml$/;
const XML_EXT = /\.xml$/;

export class DataValidator {
  async validate(input: DataValidationInput): Promise<ValidationCheck[]> {
    const checks: ValidationCheck[] = [];
    const paths = input.paths ?? [];
    const output = input.executorResult.output ?? "";

    const extractedPaths = this.extractDataPaths(output);
    const allPaths = [...new Set([...paths, ...extractedPaths])];

    for (const filePath of allPaths) {
      const check = await this.validateDataFile(filePath, input);
      checks.push(check);
    }

    if (checks.length === 0) {
      checks.push({
        type: "data",
        status: "warning",
        message: "No data files detected or configured for validation",
        evidence: "No data paths provided and none detected in output",
        details: { pathsProvided: paths.length, pathsDetected: extractedPaths.length },
      });
    }

    return checks;
  }

  private extractDataPaths(output: string): string[] {
    const paths: string[] = [];
    const words = output.split(/\s+/);
    for (const word of words) {
      const cleaned = word.replace(/[`"'.,;:!?()\[\]{}]/g, "");
      if (DATA_EXTENSIONS.test(cleaned) && cleaned.includes(".")) {
        paths.push(cleaned);
      }
    }
    return paths;
  }

  private async validateDataFile(
    filePath: string,
    input: DataValidationInput,
  ): Promise<ValidationCheck> {
    const fullPath = filePath.startsWith("/") ? filePath : `${input.projectRoot}/${filePath}`;

    const exists = await fileExists(fullPath);
    if (!exists) {
      return {
        type: "data",
        status: "failed",
        path: filePath,
        message: `Data file not found: ${filePath}`,
        evidence: "File does not exist on disk",
        failureReason: {
          reason: "file_not_found",
          detail: `Expected data file ${filePath} does not exist`,
        },
        confidence: 0,
        details: { filePath, exists: false },
      };
    }

    try {
      const content = await readTextFile(fullPath);
      const trimmed = content.trim();
      if (trimmed.length === 0) {
        return {
          type: "data",
          status: "failed",
          path: filePath,
          message: `Data file is empty: ${filePath}`,
          evidence: "File has no content",
          failureReason: { reason: "empty_file", detail: "File exists but has no data" },
          confidence: 0.1,
          details: { filePath, size: 0 },
        };
      }

      if (JSON_EXT.test(filePath)) {
        return this.validateJsonFile(filePath, content);
      }
      if (CSV_EXT.test(filePath)) {
        return this.validateCsvFile(filePath, content, input.rowLimit);
      }
      if (YAML_EXT.test(filePath)) {
        return this.validateStructuredFile(filePath, content, "yaml");
      }
      if (XML_EXT.test(filePath)) {
        return this.validateStructuredFile(filePath, content, "xml");
      }

      return {
        type: "data",
        status: "passed",
        path: filePath,
        message: `Data file exists and has content: ${filePath}`,
        evidence: `File has ${trimmed.length} characters`,
        confidence: 0.9,
        details: { filePath, size: trimmed.length },
      };
    } catch (err) {
      return {
        type: "data",
        status: "failed",
        path: filePath,
        message: `Failed to read data file: ${filePath}`,
        evidence: err instanceof Error ? err.message : String(err),
        confidence: 0,
        details: { filePath, error: String(err) },
      };
    }
  }

  private validateJsonFile(filePath: string, content: string): ValidationCheck {
    try {
      const parsed = JSON.parse(content);
      const isArray = Array.isArray(parsed);
      const isObject = typeof parsed === "object" && parsed !== null;

      return {
        type: "data",
        status: "passed",
        path: filePath,
        message: `Valid JSON file: ${filePath}`,
        evidence: isArray ? `Array with ${parsed.length} items` : "Valid JSON object",
        confidence: 1,
        details: {
          filePath,
          type: isArray ? "array" : "object",
          itemCount: isArray ? parsed.length : undefined,
          keys: isObject && !isArray ? Object.keys(parsed as object).length : undefined,
        },
      };
    } catch (err) {
      return {
        type: "data",
        status: "failed",
        path: filePath,
        message: `Invalid JSON: ${filePath}`,
        evidence: err instanceof Error ? err.message : "Failed to parse JSON",
        failureReason: {
          reason: "invalid_json",
          detail: err instanceof Error ? err.message : "JSON parse error",
        },
        confidence: 0,
        details: { filePath, error: String(err) },
      };
    }
  }

  private validateCsvFile(filePath: string, content: string, rowLimit?: number): ValidationCheck {
    const lines = content.trim().split("\n");
    if (lines.length < 2) {
      return {
        type: "data",
        status: "failed",
        path: filePath,
        message: `CSV file has no data rows: ${filePath}`,
        evidence: `Only ${lines.length} line(s) found`,
        failureReason: { reason: "no_data_rows", detail: "CSV has header but no data rows" },
        confidence: 0.1,
        details: { filePath, lines: lines.length },
      };
    }

    const header = lines[0]!;
    const columns = header.split(",").map((c) => c.trim());
    const dataRows = lines.slice(1);

    const rowCount = rowLimit ? Math.min(dataRows.length, rowLimit) : dataRows.length;
    let consistentColumns = true;
    for (let i = 0; i < rowCount; i++) {
      const rowCols = dataRows[i]!.split(",").length;
      if (rowCols !== columns.length) {
        consistentColumns = false;
        break;
      }
    }

    const passed = consistentColumns && dataRows.length > 0;

    return {
      type: "data",
      status: passed ? "passed" : "failed",
      path: filePath,
      message: passed
        ? `Valid CSV: ${filePath} (${columns.length} columns, ${dataRows.length} rows)`
        : `CSV validation issue: ${filePath}`,
      evidence: passed
        ? `${columns.length} columns, ${dataRows.length} data rows`
        : !consistentColumns
          ? "Inconsistent column counts across rows"
          : "No data rows",
      confidence: passed ? 0.95 : 0.2,
      failureReason: passed
        ? undefined
        : {
            reason: "csv_structure_invalid",
            detail: !consistentColumns ? "Column count varies between rows" : "No data rows found",
          },
      details: {
        filePath,
        columns,
        columnCount: columns.length,
        rowCount: dataRows.length,
        consistentColumns,
      },
    };
  }

  private validateStructuredFile(
    filePath: string,
    content: string,
    format: string,
  ): ValidationCheck {
    const trimmed = content.trim();
    const hasContent = trimmed.length > 0;

    return {
      type: "data",
      status: hasContent ? "passed" : "failed",
      path: filePath,
      message: hasContent
        ? `${format.toUpperCase()} file exists: ${filePath}`
        : `Empty ${format.toUpperCase()} file: ${filePath}`,
      evidence: hasContent
        ? `File has ${trimmed.length} characters, ${trimmed.split("\n").length} lines`
        : "File is empty",
      confidence: hasContent ? 0.8 : 0.1,
      failureReason: hasContent
        ? undefined
        : { reason: "empty_file", detail: `${format.toUpperCase()} content is empty` },
      details: { filePath, format, size: trimmed.length, lines: trimmed.split("\n").length },
    };
  }
}
