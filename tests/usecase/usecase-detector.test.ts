import { describe, it, expect } from "vitest";
import { UseCaseDetector } from "../../src/usecase/usecase-detector.js";
import type { UseCaseConfig } from "../../src/usecase/usecase-types.js";

describe("UseCaseDetector", () => {
  it("should detect coding use case from implementation prompts", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Implement a login feature with JWT authentication");
    expect(result.type).toBe("coding");
    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it("should detect coding from build prompts", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Build a REST API for the todo app");
    expect(result.type).toBe("coding");
  });

  it("should detect documentation use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Write API documentation for the authentication module");
    expect(result.type).toBe("documentation");
  });

  it("should detect README prompts as documentation", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Create a README file for the project");
    expect(result.type).toBe("documentation");
  });

  it("should detect debugging use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Fix the login bug that causes a crash on submit");
    expect(result.type).toBe("debugging");
  });

  it("should detect debugging from error analysis", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Debug the failing test in the payment module");
    expect(result.type).toBe("debugging");
  });

  it("should detect research use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Research the best database options for our use case");
    expect(result.type).toBe("research");
  });

  it("should detect planning use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Plan the architecture for the new microservice");
    expect(result.type).toBe("planning");
  });

  it("should detect project setup use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Set up a new Node.js project with TypeScript and ESLint");
    expect(result.type).toBe("project-setup");
  });

  it("should detect testing use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Write unit tests for the user service");
    expect(result.type).toBe("testing");
  });

  it("should detect devops use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Deploy the application to production with Docker");
    expect(result.type).toBe("devops");
  });

  it("should detect data analysis use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Analyze the sales data and create visualizations");
    expect(result.type).toBe("data-analysis");
  });

  it("should detect UI design use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Design a responsive UI for the dashboard");
    expect(result.type).toBe("ui-design");
  });

  it("should detect writing use case", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Write a blog post about our new feature release");
    expect(result.type).toBe("writing");
  });

  it("should return general for ambiguous prompts", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Help me with my project");
    expect(result.type).toBe("general");
  });

  it("should return general for empty prompts", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("");
    expect(result.type).toBe("general");
  });

  it("should include matched patterns in result", () => {
    const detector = new UseCaseDetector();
    const result = detector.detect("Fix the bug in the login module");
    expect(result.matchedPatterns.length).toBeGreaterThan(0);
  });

  it("should support custom patterns via config", () => {
    const config: UseCaseConfig = {
      enabled: true,
      customPatterns: [
        {
          type: "coding",
          patterns: ["\\bcustom-code-task\\b"],
        },
      ],
      confidenceThreshold: 0.3,
    };
    const detector = new UseCaseDetector(config);
    const result = detector.detect("This is a custom-code-task for the team");
    expect(result.type).toBe("coding");
  });

  it("should detect coding with higher confidence when multiple patterns match", () => {
    const detector = new UseCaseDetector();
    const codingResult = detector.detect(
      "Implement a new API endpoint, build the backend module, and create the service class",
    );
    const generalResult = detector.detect("Hello world");
    expect(codingResult.confidence).toBeGreaterThan(generalResult.confidence);
  });

  it("should not detect when disabled", () => {
    const config: UseCaseConfig = {
      enabled: false,
      customPatterns: [],
      confidenceThreshold: 0.3,
    };
    const detector = new UseCaseDetector(config);
    const result = detector.detect("Implement a login feature");
    expect(result.type).toBe("general");
  });

  it("should return use case hints for all types", () => {
    const detector = new UseCaseDetector();
    const types = [
      "coding",
      "documentation",
      "debugging",
      "research",
      "planning",
      "project-setup",
      "testing",
      "devops",
      "data-analysis",
      "ui-design",
      "writing",
      "general",
    ] as const;
    for (const type of types) {
      const hint = detector.getUseCaseHint(type);
      expect(hint.length).toBeGreaterThan(0);
    }
  });
});
