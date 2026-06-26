import React from "react";
import { Box, Text } from "ink";

export interface RunPanelProps {
  status: string;
  currentTaskTitle?: string;
  currentTaskExecutor?: string;
  attempt?: number;
  maxAttempts?: number;
  durationMs?: number;
}

function fmtDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function RunPanel({
  status,
  currentTaskTitle,
  currentTaskExecutor,
  attempt,
  maxAttempts,
  durationMs,
}: RunPanelProps) {
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold underline>
        Current Run
      </Text>
      {currentTaskTitle && (
        <Box marginLeft={1}>
          <Text bold> Task </Text>
          <Text>{currentTaskTitle}</Text>
        </Box>
      )}
      {currentTaskExecutor && (
        <Box marginLeft={1}>
          <Text bold> Executor </Text>
          <Text>{currentTaskExecutor}</Text>
        </Box>
      )}
      {attempt !== undefined && (
        <Box marginLeft={1}>
          <Text bold> Attempt </Text>
          <Text>
            {attempt}/{maxAttempts ?? 2}
          </Text>
        </Box>
      )}
      <Box marginLeft={1}>
        <Text bold> Duration </Text>
        <Text>{fmtDuration(durationMs)}</Text>
      </Box>
    </Box>
  );
}
