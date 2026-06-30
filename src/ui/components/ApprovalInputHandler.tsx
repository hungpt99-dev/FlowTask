import { useState, useCallback, useRef, useEffect } from "react";

interface Item {
  id: string;
  title: string;
  status: string;
}

interface StepItem extends Item {
  description?: string;
  type?: string;
  input?: Record<string, unknown>;
}

export interface ApprovalInputHandlerProps {
  runId: string;
  task: Item;
  step: StepItem;
  onProvideInput?: (runId: string, taskId: string, stepId: string, input: string) => Promise<void>;
  onApprove?: (runId: string, taskId: string, stepId: string) => Promise<void>;
  onReject?: (runId: string, taskId: string, stepId: string, reason?: string) => Promise<void>;
}

type SubmissionStatus = "idle" | "submitting" | "success" | "error";

function isApprovalStep(step: StepItem): boolean {
  return (
    step.status === "waiting_approval" ||
    step.status === "pending_approval" ||
    step.type === "approval"
  );
}

export function ApprovalInputHandler({
  runId,
  task,
  step,
  onProvideInput,
  onApprove,
  onReject,
}: ApprovalInputHandlerProps) {
  const approvalMode = isApprovalStep(step);

  const [inputValue, setInputValue] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!approvalMode && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [approvalMode]);

  const clearMessages = useCallback(() => {
    setErrorMsg(null);
    setSuccessMsg(null);
  }, []);

  const handleSubmitInput = useCallback(async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setErrorMsg("Input cannot be empty");
      return;
    }
    if (!onProvideInput) {
      setErrorMsg("Input submission is not available");
      return;
    }
    setStatus("submitting");
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await onProvideInput(runId, task.id, step.id, trimmed);
      setStatus("success");
      setSuccessMsg("Input submitted successfully");
      setInputValue("");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to submit input");
    }
  }, [inputValue, onProvideInput, runId, task.id, step.id]);

  const handleApprove = useCallback(async () => {
    if (onApprove) {
      setStatus("submitting");
      setErrorMsg(null);
      setSuccessMsg(null);
      try {
        await onApprove(runId, task.id, step.id);
        setStatus("success");
        setSuccessMsg("Step approved");
      } catch (err: unknown) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to approve step");
      }
      return;
    }
    if (onProvideInput) {
      setStatus("submitting");
      setErrorMsg(null);
      setSuccessMsg(null);
      try {
        await onProvideInput(runId, task.id, step.id, "approved");
        setStatus("success");
        setSuccessMsg("Step approved");
      } catch (err: unknown) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to approve step");
      }
    }
  }, [onApprove, onProvideInput, runId, task.id, step.id]);

  const handleReject = useCallback(async () => {
    if (onReject) {
      setStatus("submitting");
      setErrorMsg(null);
      setSuccessMsg(null);
      try {
        await onReject(runId, task.id, step.id, rejectReason.trim() || undefined);
        setStatus("success");
        setSuccessMsg("Step rejected");
      } catch (err: unknown) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to reject step");
      }
      return;
    }
    if (onProvideInput) {
      setStatus("submitting");
      setErrorMsg(null);
      setSuccessMsg(null);
      try {
        await onProvideInput(runId, task.id, step.id, "denied");
        setStatus("success");
        setSuccessMsg("Step denied");
      } catch (err: unknown) {
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to deny step");
      }
    }
  }, [onReject, onProvideInput, runId, task.id, step.id, rejectReason]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !approvalMode) {
        e.preventDefault();
        handleSubmitInput();
      }
    },
    [approvalMode, handleSubmitInput],
  );

  const submitting = status === "submitting";

  const containerStyle: React.CSSProperties = {
    padding: "12px",
    backgroundColor: approvalMode ? "#fef3cd" : "#fff3cd",
    border: approvalMode ? "1px solid #f59e0b" : "1px solid #ffc107",
    borderRadius: "6px",
  };

  const badgeStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    backgroundColor: approvalMode ? "#f59e0b" : "#ffc107",
    color: "#fff",
    marginBottom: "8px",
  };

  return (
    <div
      role="region"
      aria-label={`Waiting for ${approvalMode ? "approval" : "input"}`}
      style={containerStyle}
    >
      <div style={badgeStyle}>{approvalMode ? "Approval Required" : "Input Required"}</div>

      <div style={{ fontSize: "13px", marginBottom: "4px", color: "#92400e" }}>
        Task: <strong>{task.title}</strong> &mdash; Step: <strong>{step.title}</strong>
      </div>

      {step.description && (
        <div
          style={{
            fontSize: "12px",
            marginBottom: "8px",
            fontStyle: "italic",
            color: "#a16207",
            padding: "6px 8px",
            backgroundColor: "#fefce8",
            borderRadius: "4px",
            border: "1px solid #fde68a",
            whiteSpace: "pre-wrap",
          }}
        >
          {step.description}
        </div>
      )}

      {step.input && Object.keys(step.input).length > 0 && (
        <div
          style={{
            fontSize: "11px",
            marginBottom: "8px",
            color: "#6b7280",
            fontFamily: "monospace",
            backgroundColor: "#f9fafb",
            padding: "6px 8px",
            borderRadius: "4px",
            border: "1px solid #e5e7eb",
            whiteSpace: "pre-wrap",
          }}
        >
          {JSON.stringify(step.input, null, 2)}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: "6px 10px",
            backgroundColor: "#fef2f2",
            color: "#b91c1c",
            borderRadius: "4px",
            fontSize: "12px",
            marginBottom: "8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            border: "1px solid #fecaca",
          }}
        >
          <span>{errorMsg}</span>
          <button
            onClick={() => setErrorMsg(null)}
            aria-label="Dismiss error"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "#b91c1c",
              padding: 0,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {successMsg && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: "6px 10px",
            backgroundColor: "#f0fdf4",
            color: "#15803d",
            borderRadius: "4px",
            fontSize: "12px",
            marginBottom: "8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            border: "1px solid #bbf7d0",
          }}
        >
          <span>{successMsg}</span>
          <button
            onClick={() => setSuccessMsg(null)}
            aria-label="Dismiss"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "#15803d",
              padding: 0,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {approvalMode ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleApprove}
              disabled={submitting}
              style={{
                padding: "6px 20px",
                fontSize: "13px",
                border: "none",
                borderRadius: "4px",
                backgroundColor: submitting ? "#9ca3af" : "#f59e0b",
                color: "#fff",
                cursor: submitting ? "not-allowed" : "pointer",
                fontWeight: 600,
                minWidth: "90px",
              }}
              aria-label={submitting ? "Submitting..." : "Approve"}
            >
              {submitting ? "Submitting..." : "Approve"}
            </button>
            <button
              onClick={() => {
                setShowRejectReason((prev) => !prev);
                setRejectReason("");
              }}
              disabled={submitting}
              style={{
                padding: "6px 20px",
                fontSize: "13px",
                border: "1px solid #dc2626",
                borderRadius: "4px",
                backgroundColor: "#fff",
                color: "#dc2626",
                cursor: submitting ? "not-allowed" : "pointer",
                fontWeight: 600,
              }}
              aria-label="Reject"
            >
              Reject
            </button>
          </div>
          {showRejectReason && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (optional)..."
                rows={2}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  fontSize: "12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "4px",
                  fontFamily: "inherit",
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
                aria-label="Rejection reason"
              />
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={handleReject}
                  disabled={submitting}
                  style={{
                    padding: "4px 14px",
                    fontSize: "12px",
                    border: "none",
                    borderRadius: "4px",
                    backgroundColor: submitting ? "#9ca3af" : "#dc2626",
                    color: "#fff",
                    cursor: submitting ? "not-allowed" : "pointer",
                    fontWeight: 600,
                  }}
                >
                  {submitting ? "Submitting..." : "Confirm Reject"}
                </button>
                <button
                  onClick={() => setShowRejectReason(false)}
                  disabled={submitting}
                  style={{
                    padding: "4px 14px",
                    fontSize: "12px",
                    border: "1px solid #d1d5db",
                    borderRadius: "4px",
                    backgroundColor: "#fff",
                    color: "#374151",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              if (errorMsg) setErrorMsg(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Enter your response..."
            rows={3}
            disabled={submitting}
            style={{
              flex: 1,
              padding: "6px 8px",
              fontSize: "13px",
              border: errorMsg ? "1px solid #fecaca" : "1px solid #d1d5db",
              borderRadius: "4px",
              fontFamily: "inherit",
              resize: "vertical",
              backgroundColor: submitting ? "#f9fafb" : "#fff",
            }}
            aria-label="Input response"
            aria-invalid={!!errorMsg}
          />
          <button
            onClick={handleSubmitInput}
            disabled={submitting || !inputValue.trim()}
            style={{
              padding: "6px 16px",
              fontSize: "13px",
              border: "none",
              borderRadius: "4px",
              backgroundColor: submitting || !inputValue.trim() ? "#9ca3af" : "#f59e0b",
              color: "#fff",
              cursor: submitting || !inputValue.trim() ? "not-allowed" : "pointer",
              fontWeight: 600,
              alignSelf: "flex-start",
              minWidth: "70px",
            }}
            aria-label={submitting ? "Sending..." : "Send"}
          >
            {submitting ? "Sending..." : "Send"}
          </button>
        </div>
      )}

      {status === "idle" && !approvalMode && (
        <div style={{ fontSize: "10px", color: "#a16207", marginTop: "4px" }}>
          Press Ctrl+Enter or Cmd+Enter to submit
        </div>
      )}
    </div>
  );
}
