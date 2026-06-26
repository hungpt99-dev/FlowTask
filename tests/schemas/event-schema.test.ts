import { describe, it, expect } from "vitest";
import { EventTypeSchema } from "../../src/schemas/event.schema.js";

describe("Event schema", () => {
  it("should include resume event types", () => {
    const result = EventTypeSchema.safeParse("resume_started");
    expect(result.success).toBe(true);
  });

  it("should include retry event types", () => {
    expect(EventTypeSchema.safeParse("retry_started").success).toBe(true);
    expect(EventTypeSchema.safeParse("retry_completed").success).toBe(true);
    expect(EventTypeSchema.safeParse("retry_limit_reached").success).toBe(true);
  });

  it("should include process event types", () => {
    expect(EventTypeSchema.safeParse("process_started").success).toBe(true);
    expect(EventTypeSchema.safeParse("process_signal_sent").success).toBe(true);
    expect(EventTypeSchema.safeParse("process_stopped").success).toBe(true);
    expect(EventTypeSchema.safeParse("process_force_killed").success).toBe(true);
  });

  it("should include planner fallback event", () => {
    expect(EventTypeSchema.safeParse("planner_fallback").success).toBe(true);
  });

  it("should include run cancel events", () => {
    expect(EventTypeSchema.safeParse("run_cancelled").success).toBe(true);
    expect(EventTypeSchema.safeParse("run_cancel_requested").success).toBe(true);
  });
});
