import { describe, it, expect } from "vitest";
import { extractJsonObject, JsonExtractionError } from "../../src/utils/json-extractor.js";

describe("extractJsonObject", () => {
  it("parses full JSON output", () => {
    const result = extractJsonObject('{"title":"Test","tasks":[]}');
    expect(result.jsonText).toBe('{"title":"Test","tasks":[]}');
    expect(result.source).toBe("full_output");
  });

  it("parses fenced JSON with ```json", () => {
    const output = 'Some text\n```json\n{"title":"Test","tasks":[]}\n```\nMore text';
    const result = extractJsonObject(output);
    expect(result.jsonText).toBe('{"title":"Test","tasks":[]}');
    expect(result.source).toBe("fenced_json");
  });

  it("parses fenced JSON with plain ```", () => {
    const output = 'Here is the plan:\n```\n{"title":"Test","tasks":[]}\n```\n';
    const result = extractJsonObject(output);
    expect(result.jsonText).toBe('{"title":"Test","tasks":[]}');
    expect(result.source).toBe("fenced_json");
  });

  it("extracts first balanced JSON object from prose", () => {
    const output =
      'README for FlowTask...\nIt is a tool.\n{"title":"Real","summary":"test","tasks":[{"title":"Task 1","description":"desc","executor":"shell","acceptanceCriteria":["done"]}]}\nSome trailing text.';
    const result = extractJsonObject(output);
    expect(result.jsonText).toContain('"title":"Real"');
    expect(result.source).toBe("first_object");
  });

  it("handles braces inside strings", () => {
    const output =
      '{"title":"Test with {brace}","tasks":[{"title":"Task {nested}","description":"desc with }","executor":"shell","acceptanceCriteria":["ok"]}]}';
    const result = extractJsonObject(output);
    expect(result.source).toBe("full_output");
    const parsed = JSON.parse(result.jsonText);
    expect(parsed.title).toBe("Test with {brace}");
  });

  it("handles escaped quotes inside strings", () => {
    const output = '{"title":"Test \\"quoted\\"","tasks":[]}';
    const result = extractJsonObject(output);
    expect(result.source).toBe("full_output");
    const parsed = JSON.parse(result.jsonText);
    expect(parsed.title).toBe('Test "quoted"');
  });

  it("fails when no JSON object exists", () => {
    expect(() => extractJsonObject("README for FlowTask...")).toThrow(JsonExtractionError);
    expect(() => extractJsonObject("Just some random text without JSON.")).toThrow(
      JsonExtractionError,
    );
  });

  it("fails when only a non-object JSON value exists", () => {
    expect(() => extractJsonObject('"just a string"')).toThrow(JsonExtractionError);
  });

  it("fails when only an array exists", () => {
    expect(() => extractJsonObject("[1, 2, 3]")).toThrow(JsonExtractionError);
  });

  it("parses JSON with trailing whitespace", () => {
    const result = extractJsonObject('  \n  {"title":"Test","tasks":[]}  \n  ');
    expect(result.source).toBe("full_output");
  });

  it("parses JSON with leading prose and trailing whitespace", () => {
    const output =
      'Here is the task plan:\n\n```json\n{"title":"Update README","summary":"Update README docs","tasks":[{"title":"Review current docs","description":"Read and understand current state","executor":"shell","acceptanceCriteria":["Docs reviewed"]}]}\n```\n\n';
    const result = extractJsonObject(output);
    expect(result.source).toBe("fenced_json");
    const parsed = JSON.parse(result.jsonText);
    expect(parsed.title).toBe("Update README");
  });

  it("extracts nested JSON with multiple braces", () => {
    const output =
      '{\n  "title": "Deep",\n  "summary": "nesting",\n  "tasks": [\n    {\n      "title": "Task 1",\n      "description": "desc",\n      "executor": "shell",\n      "acceptanceCriteria": ["done"],\n      "validation": {\n        "commands": ["echo {{hello}}"]\n      }\n    }\n  ]\n}';
    const result = extractJsonObject(output);
    expect(result.source).toBe("full_output");
    const parsed = JSON.parse(result.jsonText);
    expect(parsed.tasks[0].validation.commands[0]).toBe("echo {{hello}}");
  });
});
