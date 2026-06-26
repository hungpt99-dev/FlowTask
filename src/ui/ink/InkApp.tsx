import React from "react";
import { Box } from "ink";
import { Header } from "./components/Header.js";
import { TaskTimeline } from "./components/TaskTimeline.js";
import { RunPanel } from "./components/RunPanel.js";
import { LiveOutputPanel } from "./components/LiveOutputPanel.js";
import { Footer } from "./components/Footer.js";
import { useInkRuntimeState } from "./InkRuntimeProvider.js";

export function InkApp() {
  const state = useInkRuntimeState();

  return (
    <Box flexDirection="column" gap={1} padding={0}>
      <Header
        prompt={state.prompt}
        runId={state.runId}
        planner={state.planner}
        executor={state.executor}
        status={state.status}
      />

      <TaskTimeline tasks={state.tasks} currentTaskId={state.currentTaskId} />

      <RunPanel
        status={state.status}
        currentTaskTitle={state.currentTaskTitle}
        currentTaskExecutor={state.currentTaskExecutor}
        attempt={state.currentAttempt}
        maxAttempts={state.maxAttempts}
        durationMs={state.durationMs}
      />

      <LiveOutputPanel lines={state.outputLines} maxVisibleLines={30} />

      <Footer status={state.status} reportPath={state.reportPath} runId={state.runId} />
    </Box>
  );
}
