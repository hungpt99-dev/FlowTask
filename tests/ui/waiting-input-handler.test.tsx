// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WaitingInputHandler } from "../../src/ui/components/WaitingInputHandler.js";
import type { WaitingInputProps } from "../../src/ui/components/WaitingInputHandler.js";

function makeProps(overrides: Partial<WaitingInputProps> = {}): WaitingInputProps {
  return {
    runId: "run_1",
    task: { id: "task_1", title: "Test task", status: "waiting_input" },
    step: {
      id: "step_1",
      title: "User prompt",
      status: "waiting_input",
      description: "Please enter the API endpoint",
    },
    onProvideInput: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("WaitingInputHandler", () => {
  let onProvideInput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onProvideInput = vi.fn().mockResolvedValue(undefined);
  });

  it("renders waiting for input prompt", () => {
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);
    expect(screen.getByText("Waiting for input")).toBeDefined();
    expect(screen.getByText(/Test task/)).toBeDefined();
    expect(screen.getByText(/User prompt/)).toBeDefined();
  });

  it("renders description when provided", () => {
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);
    expect(screen.getByText("Please enter the API endpoint")).toBeDefined();
  });

  it("renders textarea and send button for waiting_input", () => {
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);
    expect(screen.getByLabelText("Input response")).toBeDefined();
    expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
  });

  it("renders approve/deny buttons for waiting_approval", () => {
    render(
      <WaitingInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
            description: "Is this correct?",
          },
          task: { id: "task_1", title: "Test task", status: "waiting_approval" },
        })}
      />,
    );
    expect(screen.getByText("Waiting for approval")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDefined();
    expect(screen.queryByLabelText("Input response")).toBeNull();
  });

  it("renders approve/deny for approval type steps even with waiting_input status", () => {
    render(
      <WaitingInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_input",
            type: "approval",
            description: "Confirm?",
          },
        })}
      />,
    );
    expect(screen.getByText("Waiting for approval")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDefined();
  });

  it("disables send button when textarea is empty", () => {
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
  });

  it("sends input when user types and clicks Send", async () => {
    const user = userEvent.setup();
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    await user.type(textarea, "my response");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(onProvideInput).toHaveBeenCalledWith("run_1", "task_1", "step_1", "my response");
    });
  });

  it("calls onProvideInput with 'approved' when Approve clicked", async () => {
    render(
      <WaitingInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });

    await waitFor(() => {
      expect(onProvideInput).toHaveBeenCalledWith("run_1", "task_1", "step_a", "approved");
    });
  });

  it("calls onProvideInput with 'denied' when Deny clicked", async () => {
    render(
      <WaitingInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    });

    await waitFor(() => {
      expect(onProvideInput).toHaveBeenCalledWith("run_1", "task_1", "step_a", "denied");
    });
  });

  it("shows loading state while submitting text input", async () => {
    let resolvePromise!: () => void;
    onProvideInput = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePromise = resolve;
      }),
    );

    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    fireEvent.change(textarea, { target: { value: "input text" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    const sendButton = screen.getByRole("button", { name: "Sending..." }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    await act(async () => {
      resolvePromise();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
    });
  });

  it("shows loading state while submitting approval", async () => {
    let resolvePromise!: () => void;
    onProvideInput = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePromise = resolve;
      }),
    );

    render(
      <WaitingInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });

    expect(screen.getByText("Submitting...")).toBeDefined();
    const approveButton = screen.getByRole("button", {
      name: "Submitting...",
    }) as HTMLButtonElement;
    expect(approveButton.disabled).toBe(true);
    const denyButton = screen.getByRole("button", { name: "Deny" }) as HTMLButtonElement;
    expect(denyButton.disabled).toBe(true);

    await act(async () => {
      resolvePromise();
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    });
  });

  it("displays error when input submission fails", async () => {
    onProvideInput = vi.fn().mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup();
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    await user.type(textarea, "my response");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });
  });

  it("displays error when approval submission fails", async () => {
    onProvideInput = vi.fn().mockRejectedValue(new Error("Approval failed"));

    render(
      <WaitingInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Approval failed")).toBeDefined();
    });
  });

  it("dismisses error message", async () => {
    onProvideInput = vi.fn().mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup();
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    await user.type(textarea, "my response");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss error" }));
    });

    await waitFor(() => {
      expect(screen.queryByText("Network error")).toBeNull();
    });
  });

  it("shows generic error message when error is not an Error instance", async () => {
    onProvideInput = vi.fn().mockRejectedValue("raw string error");

    const user = userEvent.setup();
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    await user.type(textarea, "input");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to send input")).toBeDefined();
    });
  });

  it("clears textarea on successful submission", async () => {
    const user = userEvent.setup();
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response") as HTMLTextAreaElement;
    await user.type(textarea, "text to clear");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  it("does not submit when Send clicked with empty input", async () => {
    render(<WaitingInputHandler {...makeProps({ onProvideInput })} />);

    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.click(sendButton);
    expect(onProvideInput).not.toHaveBeenCalled();
  });
});
