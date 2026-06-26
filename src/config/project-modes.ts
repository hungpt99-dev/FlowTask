export type ProjectMode = "development" | "writing" | "research" | "general";

export const VALID_PROJECT_MODES: ProjectMode[] = ["development", "writing", "research", "general"];

export interface ModeDefinition {
  mode: ProjectMode;
  label: string;
  description: string;
}

export const MODE_DEFINITIONS: ModeDefinition[] = [
  {
    mode: "development",
    label: "Development / Coding",
    description: "Software projects, coding, debugging, refactoring, tests, implementation",
  },
  {
    mode: "writing",
    label: "Writing / Documents",
    description: "Documents, prompts, idea docs, technical docs, proposals, scripts",
  },
  {
    mode: "research",
    label: "Research",
    description: "Research, comparison, competitor analysis, source notes, briefs",
  },
  {
    mode: "general",
    label: "General",
    description: "Generic AI task workflows",
  },
];

export function getModeDefinition(mode: ProjectMode): ModeDefinition {
  const def = MODE_DEFINITIONS.find((m) => m.mode === mode);
  if (!def) {
    throw new Error(`Unknown project mode: ${mode}`);
  }
  return def;
}
