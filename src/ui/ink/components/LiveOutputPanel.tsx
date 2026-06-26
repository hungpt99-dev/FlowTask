import React, { useMemo } from "react";
import { Box, Text } from "ink";

export interface OutputLine {
  id: string;
  taskId?: string;
  executor?: string;
  stream?: "stdout" | "stderr";
  text: string;
}

export interface LiveOutputPanelProps {
  lines: OutputLine[];
  maxVisibleLines?: number;
}

export function LiveOutputPanel({ lines, maxVisibleLines = 30 }: LiveOutputPanelProps) {
  const visible = useMemo(() => {
    return lines.slice(-maxVisibleLines);
  }, [lines, maxVisibleLines]);

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold underline>
        Live Output
      </Text>
      {visible.length === 0 && (
        <Box marginLeft={1}>
          <Text dimColor>Waiting for output...</Text>
        </Box>
      )}
      {visible.map((line) => {
        const isStderr = line.stream === "stderr";
        const prefix = line.executor ? `[${line.executor}]` : "";
        const prefixFull = isStderr ? `[stderr] ${prefix}` : prefix;
        const display = truncateLine(line.text, 200);
        return (
          <Box key={line.id} marginLeft={1}>
            {prefixFull && <Text dimColor>{prefixFull} </Text>}
            <Text color={isStderr ? "yellow" : undefined}>{display}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function truncateLine(line: string, max: number): string {
  if (!line) return "";
  if (line.length <= max) return line;
  return line.slice(0, max) + "...";
}
