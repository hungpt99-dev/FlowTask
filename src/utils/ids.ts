import { randomUUID } from "node:crypto";

export function generateRunId(title: string): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z/, "");
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 30);
  return `run_${timestamp}_${slug}`;
}

export function generateTaskId(): string {
  const hex = randomUUID().replace(/-/g, "").slice(0, 12);
  return `task_${hex}`;
}

export function generateArtifactId(): string {
  const hex = randomUUID().replace(/-/g, "").slice(0, 12);
  return `artifact_${hex}`;
}

export function generateProjectId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
