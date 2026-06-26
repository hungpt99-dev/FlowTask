import React from "react";
import { Box, Text } from "ink";
import { StatusBadge } from "./StatusBadge.js";
import { Spinner } from "./Spinner.js";

export interface TaskView {
  id: string;
  title: string;
  status: string;
  executor?: string;
}

export interface TaskTimelineProps {
  tasks: TaskView[];
  currentTaskId?: string;
}

export function TaskTimeline({ tasks, currentTaskId }: TaskTimelineProps) {
  return (
    <Box flexDirection="column" gap={0}>
      <Text bold underline>
        Tasks
      </Text>
      {tasks.length === 0 && (
        <Box marginLeft={1}>
          <Text dimColor>No tasks yet</Text>
        </Box>
      )}
      {tasks.map((task) => {
        const isCurrent = task.id === currentTaskId;
        const isRunning = task.status === "running";
        return (
          <Box key={task.id} marginLeft={1}>
            <Box marginRight={1} width={1}>
              {isRunning ? <Spinner active /> : <StatusBadge status={task.status} />}
            </Box>
            <Text bold={isCurrent} color={isCurrent ? "blue" : undefined}>
              {task.title}
            </Text>
            {isCurrent && <Text color="blue"> ◀</Text>}
            {task.status === "failed" && <Text color="red"> ✗</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
