import React from "react";
import { Box, Text } from "ink";

export interface FooterProps {
  status: string;
  reportPath?: string;
  runId?: string;
}

export function Footer({ status, reportPath, runId }: FooterProps) {
  return (
    <Box flexDirection="column">
      <Box>
        {status === "running" && (
          <Text dimColor>Ctrl+C stop gracefully · logs are being saved</Text>
        )}
        {status === "completed" && (
          <Text dimColor>Run completed{reportPath ? ` · Report: ${reportPath}` : ""}</Text>
        )}
        {status === "failed" && (
          <Box flexDirection="column">
            <Text dimColor>Run failed</Text>
            <Text dimColor>
              {runId
                ? `flowtask retry <taskId> · flowtask inspect ${runId}`
                : "flowtask retry <taskId>"}
            </Text>
          </Box>
        )}
        {status === "cancelled" && <Text dimColor>Run cancelled</Text>}
      </Box>
    </Box>
  );
}
