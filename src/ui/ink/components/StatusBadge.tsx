import React from "react";
import { Text } from "ink";

export type TaskStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "retrying"
  | "paused"
  | "cancelled";

const STATUS_SYMBOLS: Record<string, string> = {
  done: "✓",
  running: "●",
  pending: "○",
  failed: "✗",
  retrying: "↻",
  paused: "⏸",
  cancelled: "■",
};

const STATUS_COLORS: Record<string, string> = {
  done: "green",
  running: "blue",
  pending: "gray",
  failed: "red",
  retrying: "yellow",
  paused: "yellow",
  cancelled: "gray",
};

export interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const symbol = STATUS_SYMBOLS[status] ?? "·";
  const color = STATUS_COLORS[status] ?? "white";
  return <Text color={color}>{symbol}</Text>;
}
