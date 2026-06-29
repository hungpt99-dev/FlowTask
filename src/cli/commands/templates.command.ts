import { TemplateRegistry } from "../../templates/template-registry.js";

const registry = new TemplateRegistry();

export async function templatesListCommand(filter?: string): Promise<void> {
  const names = await registry.getTemplateNames();
  const filtered = filter
    ? names.filter(
        (t) =>
          t.name.toLowerCase().includes(filter.toLowerCase()) ||
          t.id.toLowerCase().includes(filter.toLowerCase()) ||
          t.category.toLowerCase().includes(filter.toLowerCase()) ||
          t.workflowType.toLowerCase().includes(filter.toLowerCase()),
      )
    : names;

  if (filtered.length === 0) {
    console.log(`No templates found${filter ? ` matching "${filter}"` : ""}.`);
    return;
  }

  const maxIdLen = Math.max(...filtered.map((t) => t.id.length));
  const maxNameLen = Math.max(...filtered.map((t) => t.name.length));

  console.log(
    `\n  ${"ID".padEnd(maxIdLen + 2)} ${"Name".padEnd(maxNameLen + 2)} Category${" ".repeat(12)} Steps`,
  );
  console.log(
    `  ${"".padEnd(maxIdLen + 2, "─")} ${"".padEnd(maxNameLen + 2, "─")} ${"".repeat(20)} ${"".repeat(5)}`,
  );

  for (const t of filtered) {
    console.log(
      `  ${t.id.padEnd(maxIdLen + 2)} ${t.name.padEnd(maxNameLen + 2)} ${t.category.padEnd(20)} ${t.typicalSteps}`,
    );
  }
  console.log(`\n  ${filtered.length} template(s) found.`);
  console.log(`  Use \`flowtask run --template <id> "<prompt>"\` to use a template.`);
}

export async function templatesShowCommand(templateId: string): Promise<void> {
  const template = await registry.getTemplate(templateId);
  if (!template) {
    console.log(`Template "${templateId}" not found.`);
    return;
  }

  console.log(`\n  ${template.name}`);
  console.log(`  ${"".padEnd(template.name.length, "=")}`);
  console.log(`  ID:         ${template.id}`);
  console.log(`  Version:    ${template.version}`);
  console.log(`  Category:   ${template.category}`);
  console.log(`  Workflow:   ${template.workflowType}`);
  console.log(`  Tags:       ${template.tags.join(", ")}`);
  console.log(`  Mode:       ${template.defaultMode}`);
  console.log(`  Estimated:  ${template.estimatedDuration ?? "varies"}`);
  console.log(`  Steps:      ${template.steps.length}`);
  console.log(`  Description: ${template.description}`);
  console.log("");

  console.log(`  Steps:\n`);
  for (let i = 0; i < template.steps.length; i++) {
    const step = template.steps[i]!;
    const deps = step.dependsOn.length > 0 ? ` (after: ${step.dependsOn.join(", ")})` : "";
    console.log(`    ${i + 1}. ${step.title}${deps}`);
    console.log(`       ${step.description.slice(0, 120)}`);
    console.log(
      `       Task: ${step.taskType} | Action: ${step.actionType} | Risk: ${step.riskLevel}`,
    );
    if (step.approvalRequired) console.log(`       ⚠ Requires approval`);
    if (step.targetFiles.length > 0) console.log(`       Files: ${step.targetFiles.join(", ")}`);
    if (step.targetArtifacts.length > 0)
      console.log(`       Artifacts: ${step.targetArtifacts.join(", ")}`);
    if (step.acceptanceCriteria.length > 0) {
      console.log(`       Criteria:`);
      for (const ac of step.acceptanceCriteria) {
        console.log(`         - ${ac}`);
      }
    }
    console.log("");
  }
}

export async function templatesCategoriesCommand(): Promise<void> {
  const categories = await registry.listCategories();
  console.log(`\n  Template Categories:\n`);
  for (const cat of categories) {
    const templates = await registry.findTemplates({ category: cat });
    console.log(`  ${cat}:`);
    for (const t of templates) {
      console.log(`    - ${t.name} (${t.id})`);
    }
    console.log("");
  }
}

export async function templatesInferCommand(prompt: string): Promise<void> {
  const { inferTemplateId } = await import("../../templates/template-registry.js");
  const id = inferTemplateId(prompt);
  const template = await registry.getTemplate(id);
  if (template) {
    console.log(`\n  Inferred template: ${template.name} (${template.id})\n`);
    console.log(`  Use: flowtask run --template ${template.id} "${prompt}"`);
  } else {
    console.log(`\n  Could not infer a template for the given prompt.`);
  }
}
