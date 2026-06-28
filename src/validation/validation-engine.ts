import type { ValidationResult, ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import type { Task } from "../schemas/task.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { ProcessValidator } from "./process-validator.js";
import { FileValidator } from "./file-validator.js";
import { CommandValidator } from "./command-validator.js";
import { AcceptanceCriteriaValidator } from "./acceptance-criteria-validator.js";
import { ContentValidator } from "./content-validator.js";
import { now } from "../utils/time.js";

export interface ValidateTaskInput {
  projectRoot: string;
  task: Task;
  executorResult: ExecutorResult;
}

export class ValidationEngine {
  private processValidator: ProcessValidator;
  private fileValidator: FileValidator;
  private commandValidator: CommandValidator;
  private acceptanceCriteriaValidator: AcceptanceCriteriaValidator;
  private contentValidator: ContentValidator;

  constructor(config?: FlowTaskConfig) {
    this.processValidator = new ProcessValidator();
    this.fileValidator = new FileValidator();
    this.commandValidator = new CommandValidator(config);
    this.acceptanceCriteriaValidator = new AcceptanceCriteriaValidator();
    this.contentValidator = new ContentValidator();
  }

  async validateTask(input: ValidateTaskInput): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];

    const processCheck = await this.processValidator.validate(input.executorResult);
    checks.push(processCheck);

    if (input.task.validation?.requiredFiles && input.task.validation.requiredFiles.length > 0) {
      const fileChecks = await this.fileValidator.validateFiles(
        input.projectRoot,
        input.task.validation.requiredFiles,
      );
      checks.push(...fileChecks);
    }

    if (
      input.task.validation?.requiredContent &&
      input.task.validation.requiredContent.length > 0
    ) {
      const contentChecks = await this.contentValidator.validateContent(
        input.projectRoot,
        input.task.validation.requiredContent,
      );
      checks.push(...contentChecks);
    }

    if (input.task.validation?.commands && input.task.validation.commands.length > 0) {
      const commandChecks = await this.commandValidator.validateCommands(
        input.task.validation.commands,
        input.projectRoot,
      );
      checks.push(...commandChecks);
    }

    if (input.task.acceptanceCriteria && input.task.acceptanceCriteria.length > 0) {
      const criteriaChecks = await this.acceptanceCriteriaValidator.validate(
        input.task.acceptanceCriteria,
        input.executorResult,
        input.projectRoot,
      );
      checks.push(...criteriaChecks);
    }

    if (checks.length === 0) {
      return {
        taskId: input.task.id,
        status: "warning",
        checks: [],
        createdAt: now(),
      };
    }

    const allPassed = checks.every((c) => c.status === "passed");
    const anyFailed = checks.some((c) => c.status === "failed");

    let finalStatus: ValidationResult["status"];
    if (anyFailed) finalStatus = "failed";
    else if (allPassed) finalStatus = "passed";
    else finalStatus = "warning";

    return {
      taskId: input.task.id,
      status: finalStatus,
      checks,
      createdAt: now(),
    };
  }
}
