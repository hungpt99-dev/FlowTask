import type { ValidationResult, ValidationCheck } from "../schemas/validation.schema.js";
import type { ExecutorResult } from "../executor/executor.js";
import type { Task } from "../schemas/task.schema.js";
import type { FlowTaskConfig } from "../schemas/config.schema.js";
import { ProcessValidator } from "./process-validator.js";
import { CommandValidator } from "./command-validator.js";
import { AcceptanceCriteriaValidator } from "./acceptance-criteria-validator.js";
import { OutcomeComparisonValidator } from "./outcome-comparison-validator.js";
import { OutputPlanValidator } from "./output-plan-validator.js";
import { now } from "../utils/time.js";

export interface ValidateTaskInput {
  projectRoot: string;
  task: Task;
  executorResult: ExecutorResult;
}

export class ValidationEngine {
  private processValidator: ProcessValidator;
  private commandValidator: CommandValidator;
  private acceptanceCriteriaValidator: AcceptanceCriteriaValidator;
  private outcomeComparisonValidator: OutcomeComparisonValidator;
  private outputPlanValidator: OutputPlanValidator;
  private adaptiveValidation: boolean;

  constructor(config?: FlowTaskConfig) {
    this.processValidator = new ProcessValidator();
    this.commandValidator = new CommandValidator(config);
    this.acceptanceCriteriaValidator = new AcceptanceCriteriaValidator();
    this.outcomeComparisonValidator = new OutcomeComparisonValidator();
    this.outputPlanValidator = new OutputPlanValidator();
    this.adaptiveValidation = config?.validation?.adaptiveValidation ?? true;
  }

  async validateTask(input: ValidateTaskInput): Promise<ValidationResult> {
    const checks: ValidationCheck[] = [];

    const processCheck = await this.processValidator.validate(input.executorResult);
    checks.push(processCheck);

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

    if (input.task.expectedResult) {
      const outcomeCheck = await this.outcomeComparisonValidator.validate(
        input.task.expectedResult,
        input.executorResult,
        input.projectRoot,
      );
      checks.push(outcomeCheck);
    }

    if (input.task.outputPlan && input.task.outputPlan.length > 0) {
      const outputPlanChecks = await this.outputPlanValidator.validate(
        input.task.outputPlan,
        input.executorResult,
        input.projectRoot,
      );
      checks.push(...outputPlanChecks);
    }

    if (checks.length === 0) {
      return {
        taskId: input.task.id,
        status: "warning",
        checks: [],
        createdAt: now(),
      };
    }

    if (input.task.expectedResult && this.adaptiveValidation) {
      return this.determineAdaptiveResult(input.task.id, checks);
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

  private determineAdaptiveResult(taskId: string, checks: ValidationCheck[]): ValidationResult {
    const outcomeCheck = checks.find((c) => c.type === "outcome_comparison");
    const otherChecks = checks.filter((c) => c.type !== "outcome_comparison");
    const otherFailed = otherChecks.some((c) => c.status === "failed");

    if (outcomeCheck) {
      let finalStatus: ValidationResult["status"];

      switch (outcomeCheck.status) {
        case "passed":
          finalStatus = otherFailed ? "warning" : "passed";
          break;
        case "warning":
          finalStatus = otherFailed ? "failed" : "warning";
          break;
        case "failed":
          finalStatus = "failed";
          break;
        default:
          finalStatus = outcomeCheck.status;
      }

      return {
        taskId,
        status: finalStatus,
        checks,
        createdAt: now(),
      };
    }

    const allPassed = checks.every((c) => c.status === "passed");
    const anyFailed = checks.some((c) => c.status === "failed");

    return {
      taskId,
      status: anyFailed ? "failed" : allPassed ? "passed" : "warning",
      checks,
      createdAt: now(),
    };
  }
}
