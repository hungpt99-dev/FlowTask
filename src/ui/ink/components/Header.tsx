import React from "react";
import { Box, Text } from "ink";

export interface HeaderProps {
  prompt: string;
  runId?: string;
  planner?: string;
  executor?: string;
  status: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "green",
  running: "blue",
  planning: "yellow",
  failed: "red",
  cancelled: "gray",
  paused: "yellow",
};

export function Header({ prompt, runId, planner, executor, status }: HeaderProps) {
  const statusColor = STATUS_COLORS[status] ?? "white";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} gap={0}>
      <Text bold color="cyan">
        FlowTask
      </Text>
      <Box>
        <Text bold> Prompt </Text>
        <Text>{prompt}</Text>
      </Box>
      {runId && (
        <Box>
          <Text bold> Run ID </Text>
          <Text dimColor>{runId}</Text>
        </Box>
      )}
      <Box>
        <Text bold> Status </Text>
        <Text color={statusColor}>{status}</Text>
      </Box>
      {planner && (
        <Box>
          <Text bold> Planner </Text>
          <Text>{planner}</Text>
        </Box>
      )}
      {executor && (
        <Box>
          <Text bold> Executor </Text>
          <Text>{executor}</Text>
        </Box>
      )}
    </Box>
  );
}
