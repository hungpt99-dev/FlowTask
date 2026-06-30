// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalInputHandler } from "../../src/ui/components/ApprovalInputHandler.js";
import type { ApprovalInputHandlerProps } from "../../src/ui/components/ApprovalInputHandler.js";

function makeProps(overrides: Partial<ApprovalInputHandlerProps> = {}): ApprovalInputHandlerProps {
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
    onApprove: undefined,
    onReject: undefined,
    ...overrides,
  };
}

describe("ApprovalInputHandler", () => {
  let onProvideInput: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onProvideInput = vi.fn().mockResolvedValue(undefined);
  });

  it("renders input required badge for waiting_input", () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);
    expect(screen.getByText("Input Required")).toBeDefined();
    expect(screen.getByText(/Test task/)).toBeDefined();
    expect(screen.getByText(/User prompt/)).toBeDefined();
  });

  it("renders approval required badge for waiting_approval", () => {
    render(
      <ApprovalInputHandler
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
    expect(screen.getByText("Approval Required")).toBeDefined();
  });

  it("renders description when provided", () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);
    expect(screen.getByText("Please enter the API endpoint")).toBeDefined();
  });

  it("renders textarea and send button for waiting_input", () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);
    expect(screen.getByLabelText("Input response")).toBeDefined();
    expect(screen.getByRole("button", { name: "Send" })).toBeDefined();
  });

  it("renders approve and reject buttons for waiting_approval", () => {
    render(
      <ApprovalInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
          task: { id: "task_1", title: "Test task", status: "waiting_approval" },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
    expect(screen.queryByLabelText("Input response")).toBeNull();
  });

  it("renders approval mode for approval type steps even with waiting_input status", () => {
    render(
      <ApprovalInputHandler
        {...makeProps({
          onProvideInput,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_input",
            type: "approval",
          },
        })}
      />,
    );
    expect(screen.getByText("Approval Required")).toBeDefined();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
  });

  it("disables send button when textarea is empty", () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);
    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
  });

  it("sends input when user types and clicks Send", async () => {
    const user = userEvent.setup();
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    await user.type(textarea, "my response");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(onProvideInput).toHaveBeenCalledWith("run_1", "task_1", "step_1", "my response");
    });
  });

  it("calls onProvideInput with 'approved' via fallback when Approve clicked", async () => {
    render(
      <ApprovalInputHandler
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

  it("calls onApprove when provided instead of fallback", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalInputHandler
        {...makeProps({
          onApprove,
          onProvideInput: undefined,
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
      expect(onApprove).toHaveBeenCalledWith("run_1", "task_1", "step_a");
    });
  });

  it("calls onReject when provided and Reject reason is submitted", async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalInputHandler
        {...makeProps({
          onReject,
          onProvideInput: undefined,
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    });

    const reasonTextarea = screen.getByLabelText("Rejection reason");
    expect(reasonTextarea).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm Reject" }));
    });

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith("run_1", "task_1", "step_a", undefined);
    });
  });

  it("shows loading state while submitting text input", async () => {
    let resolvePromise!: () => void;
    onProvideInput = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolvePromise = resolve;
      }),
    );

    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

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
      <ApprovalInputHandler
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
    const rejectButton = screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement;
    expect(rejectButton.disabled).toBe(true);

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
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

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
      <ApprovalInputHandler
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
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

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
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    await user.type(textarea, "input");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Failed to submit input")).toBeDefined();
    });
  });

  it("clears textarea on successful submission", async () => {
    const user = userEvent.setup();
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response") as HTMLTextAreaElement;
    await user.type(textarea, "text to clear");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(textarea.value).toBe("");
    });
  });

  it("shows success message after successful input submission", async () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    fireEvent.change(textarea, { target: { value: "valid input" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Input submitted successfully")).toBeDefined();
    });
  });

  it("shows success message after approval via onApprove", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <ApprovalInputHandler
        {...makeProps({
          onApprove,
          onProvideInput: undefined,
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
      expect(screen.getByText("Step approved")).toBeDefined();
    });
  });

  it("does not submit when Send clicked with empty input", async () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);

    fireEvent.click(sendButton);
    expect(onProvideInput).not.toHaveBeenCalled();
  });

  it("disables send button when input is whitespace-only", () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);

    const textarea = screen.getByLabelText("Input response");
    fireEvent.change(textarea, { target: { value: "   " } });

    const sendButton = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
  });

  it("shows rejection reason textarea when Reject is clicked", async () => {
    render(
      <ApprovalInputHandler
        {...makeProps({
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    });

    expect(screen.getByLabelText("Rejection reason")).toBeDefined();
    expect(screen.getByRole("button", { name: "Confirm Reject" })).toBeDefined();
  });

  it("hides rejection reason when Cancel is clicked", async () => {
    render(
      <ApprovalInputHandler
        {...makeProps({
          step: {
            id: "step_a",
            title: "Approve step",
            status: "waiting_approval",
          },
        })}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    });

    expect(screen.getByLabelText("Rejection reason")).toBeDefined();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByLabelText("Rejection reason")).toBeNull();
  });

  it("shows keyboard shortcut hint in input mode", () => {
    render(<ApprovalInputHandler {...makeProps({ onProvideInput })} />);
    expect(screen.getByText(/Ctrl\+Enter/)).toBeDefined();
  });
});
