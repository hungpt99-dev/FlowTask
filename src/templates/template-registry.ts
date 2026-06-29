import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandGlob } from "../utils/glob.js";
import type { WorkflowTemplate } from "../schemas/template.schema.js";
import {
  WorkflowTemplateSchema,
  WorkflowTemplateCollectionSchema,
} from "../schemas/template.schema.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface TemplateFilter {
  workflowType?: string;
  category?: string;
  tag?: string;
  id?: string;
}

export class TemplateRegistry {
  private templates: WorkflowTemplate[] = [];
  private loaded = false;

  private async resolveTemplateDir(): Promise<string> {
    const candidates = [
      CURRENT_DIR,
      path.join(process.cwd(), "src", "templates"),
      path.join(path.dirname(CURRENT_DIR), "templates"),
    ];
    for (const dir of candidates) {
      try {
        const stat = await fs.stat(dir);
        if (stat.isDirectory()) {
          const files = await fs.readdir(dir);
          if (files.some((f) => f.endsWith("-template.json"))) {
            return dir;
          }
        }
      } catch {
        /* try next */
      }
    }
    const fallback = CURRENT_DIR;
    return fallback;
  }

  async loadAll(): Promise<WorkflowTemplate[]> {
    if (this.loaded) return this.templates;
    this.templates = await this.load();
    this.loaded = true;
    return this.templates;
  }

  async load(): Promise<WorkflowTemplate[]> {
    const dir = await this.resolveTemplateDir();
    const pattern = path.join(dir, "*-template.json");
    const files = await expandGlob(pattern, { absolute: true });

    if (files.length === 0) {
      return [];
    }

    const templates: WorkflowTemplate[] = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const parsed = JSON.parse(content);
        const result = WorkflowTemplateSchema.safeParse(parsed);
        if (result.success) {
          templates.push(result.data);
        }
      } catch {
        /* skip invalid template files */
      }
    }

    const collectionResult = WorkflowTemplateCollectionSchema.safeParse(templates);
    if (!collectionResult.success) {
      return [];
    }

    return collectionResult.data;
  }

  async getTemplate(id: string): Promise<WorkflowTemplate | undefined> {
    const templates = await this.loadAll();
    return templates.find((t) => t.id === id);
  }

  async findTemplates(filter: TemplateFilter): Promise<WorkflowTemplate[]> {
    const templates = await this.loadAll();
    return templates.filter((t) => {
      if (filter.id && t.id !== filter.id) return false;
      if (filter.workflowType && t.workflowType !== filter.workflowType) return false;
      if (filter.category && t.category !== filter.category) return false;
      if (filter.tag && !t.tags.includes(filter.tag)) return false;
      return true;
    });
  }

  async listCategories(): Promise<string[]> {
    const templates = await this.loadAll();
    const categories = new Set(templates.map((t) => t.category));
    return Array.from(categories).sort();
  }

  async listWorkflowTypes(): Promise<string[]> {
    const templates = await this.loadAll();
    const types = new Set(templates.map((t) => t.workflowType));
    return Array.from(types).sort();
  }

  async getTemplateByWorkflowType(workflowType: string): Promise<WorkflowTemplate | undefined> {
    const templates = await this.loadAll();
    return templates.find((t) => t.workflowType === workflowType);
  }

  async getTemplateNames(): Promise<
    {
      id: string;
      name: string;
      description: string;
      category: string;
      workflowType: string;
      typicalSteps: number;
    }[]
  > {
    const templates = await this.loadAll();
    return templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      workflowType: t.workflowType,
      typicalSteps: t.typicalSteps ?? t.steps.length,
    }));
  }

  async count(): Promise<number> {
    const templates = await this.loadAll();
    return templates.length;
  }

  clearCache(): void {
    this.loaded = false;
    this.templates = [];
  }
}

export function inferTemplateId(prompt: string): string {
  const lower = prompt.toLowerCase();
  const has = (pattern: string): boolean => new RegExp(pattern).test(lower);

  if (has("\\b(bug|crash|broken)\\b") || has("\\b(fix|error|debug|issue)\\b")) return "bug-fix";
  if (has("\\b(refactor|restructure|reorganize)\\b")) return "refactor";

  if (has("unit.?test|integration.?test|test.?suite|test.?case|test.?gen|\\bspec\\b"))
    return "test-generation";

  if (has("\\bclean\\b.*\\bdata\\b|\\bdata\\b.*\\bclean\\b|dedup|normalize data"))
    return "data-cleanup";
  if (has("data.?analysis|statistic|chart|graph|visualize")) return "data-analysis";

  if (has("\\b(translate|i18n|l10n|localize)\\b")) return "translation";
  if (has("\\b(meeting|minutes|agenda)\\b") || has("action.?item")) return "meeting-summary";

  if (has("\\bprompt\\b") && has("\\b(eng|design|create|write|test)\\b"))
    return "prompt-engineering";

  if (has("\\brequirements?\\b|\\bspecification\\b|functional.?req")) return "requirement-analysis";
  if (has("qa.?checklist|quality.?assure")) return "qa-checklist";
  if (has("\\b(release|rollout|deploy)\\b")) return "release-checklist";
  if (has("product.?plan|\\b(roadmap|backlog)\\b")) return "product-planning";

  if (has("business.?analysis|\\bba\\b|gap.?analysis|\\bstakeholder\\b"))
    return "business-analysis";
  if (has("\\b(research|investigate|explore)\\b")) return "research";
  if (has("\\b(documentation|readme)\\b|api.?doc")) return "documentation";

  if (has("\\b(report|summary)\\b")) return "report-generation";
  if (has("\\b(write|content|blog|article|copy)\\b")) return "writing";
  if (has("\\b(design|wireframe|mockup|prototype)\\b|\\b(ui|ux)\\b")) return "design";

  if (has("\\b(implement|functionality|feature|code)\\b")) return "code-feature";
  if (has("\\b(mixed|complex)\\b|multi.?step|full.?stack|end.?to.?end")) return "mixed";

  if (has("analyze") && has("\\b(data|sales|metric|result)\\b")) return "data-analysis";
  if (has("analyze") && has("\\b(requirement|business)\\b")) return "requirement-analysis";
  if (has("\\banalyze\\b")) return "research";

  if (has("\\b(ops|operation|infra|infrastructure|monitor)\\b")) return "operations";

  if (has("\\btest\\b")) return "test-generation";
  if (has("\\bdoc\\b") || has("\\bdocument\\b")) return "documentation";
  if (has("\\breport\\b") || has("\\bsummary\\b")) return "report-generation";
  if (has("\\bpublish\\b") || has("\\bversion\\b")) return "release-checklist";

  return "general-task";
}
