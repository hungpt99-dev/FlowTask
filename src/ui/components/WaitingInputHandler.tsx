import { useState, useCallback } from "react";

export interface WaitingInputProps {
  runId: string;
  task: { id: string; title: string; status: string };
  step: {
    id: string;
    title: string;
    status: string;
    description?: string;
    type?: string;
  };
  onProvideInput: (runId: string, taskId: string, stepId: string, input: string) => Promise<void>;
}

export function WaitingInputHandler({ runId, task, step, onProvideInput }: WaitingInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isApproval = step.status === "waiting_approval" || step.type === "approval";

  const submitInput = useCallback(
    async (input: string) => {
      setLoading(true);
      setError(null);
      try {
        await onProvideInput(runId, task.id, step.id, input);
        setInputValue("");
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to send input");
      } finally {
        setLoading(false);
      }
    },
    [runId, task.id, step.id, onProvideInput],
  );

  const handleSend = useCallback(() => {
    if (!inputValue.trim()) return;
    submitInput(inputValue.trim());
  }, [inputValue, submitInput]);

  const handleApprove = useCallback(() => {
    submitInput("approved");
  }, [submitInput]);

  const handleDeny = useCallback(() => {
    submitInput("denied");
  }, [submitInput]);

  return (
    <div
      role="region"
      aria-label="Waiting for input"
      style={{
        padding: "12px",
        backgroundColor: "#fff3cd",
        border: "1px solid #ffc107",
        borderRadius: "6px",
      }}
    >
      <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
        Waiting for {isApproval ? "approval" : "input"}
      </div>
      <div style={{ fontSize: "13px", marginBottom: "8px", color: "#856404" }}>
        Task: <strong>{task.title}</strong> &mdash; Step: <strong>{step.title}</strong>
      </div>
      {step.description && (
        <div style={{ fontSize: "13px", marginBottom: "8px", fontStyle: "italic" }}>
          {step.description}
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: "6px 10px",
            backgroundColor: "#f8d7da",
            color: "#721c24",
            borderRadius: "4px",
            fontSize: "12px",
            marginBottom: "8px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            aria-label="Dismiss error"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "#721c24",
              padding: 0,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {isApproval ? (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={handleApprove}
            disabled={loading}
            style={{
              padding: "6px 20px",
              fontSize: "13px",
              border: "none",
              borderRadius: "4px",
              backgroundColor: loading ? "#6c757d" : "#28a745",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {loading ? "Submitting..." : "Approve"}
          </button>
          <button
            onClick={handleDeny}
            disabled={loading}
            style={{
              padding: "6px 20px",
              fontSize: "13px",
              border: "1px solid #dc3545",
              borderRadius: "4px",
              backgroundColor: "#fff",
              color: "#dc3545",
              cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            Deny
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
          <textarea
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Enter your response..."
            rows={3}
            style={{
              flex: 1,
              padding: "6px 8px",
              fontSize: "13px",
              border: "1px solid #ced4da",
              borderRadius: "4px",
              fontFamily: "inherit",
              resize: "vertical",
            }}
            aria-label="Input response"
          />
          <button
            onClick={handleSend}
            disabled={loading || !inputValue.trim()}
            style={{
              padding: "6px 16px",
              fontSize: "13px",
              border: "none",
              borderRadius: "4px",
              backgroundColor: loading || !inputValue.trim() ? "#6c757d" : "#ffc107",
              color: "#fff",
              cursor: loading || !inputValue.trim() ? "not-allowed" : "pointer",
              fontWeight: 600,
              alignSelf: "flex-start",
            }}
          >
            {loading ? "Sending..." : "Send"}
          </button>
        </div>
      )}
    </div>
  );
}
