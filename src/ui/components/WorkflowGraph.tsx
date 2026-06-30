import { useMemo, useCallback, type KeyboardEvent } from "react";
import type { WorkflowTask } from "../../schemas/workflow.schema.js";

export type TaskDisplayStatus =
  | "pending"
  | "running"
  | "waiting_input"
  | "success"
  | "failed"
  | "skipped";

export interface WorkflowGraphProps {
  tasks: WorkflowTask[];
  taskStatuses?: Record<string, TaskDisplayStatus>;
  selectedTaskId?: string | null;
  onTaskClick?: (taskId: string) => void;
  onTaskDoubleClick?: (taskId: string) => void;
  emptyMessage?: string;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const H_GAP = 40;
const V_GAP = 80;
const PADDING = 24;

interface NodeColors {
  fill: string;
  stroke: string;
  text: string;
}

const STATUS_COLORS: Record<string, NodeColors> = {
  pending: { fill: "#fef9c3", stroke: "#eab308", text: "#a16207" },
  running: { fill: "#dbeafe", stroke: "#3b82f6", text: "#1d4ed8" },
  waiting_input: { fill: "#f3e8ff", stroke: "#a855f7", text: "#7e22ce" },
  success: { fill: "#dcfce7", stroke: "#22c55e", text: "#15803d" },
  failed: { fill: "#fee2e2", stroke: "#ef4444", text: "#b91c1c" },
  skipped: { fill: "#f3f4f6", stroke: "#9ca3af", text: "#6b7280" },
};

const DEFAULT_COLORS = STATUS_COLORS.pending;

interface LayoutNode {
  id: string;
  title: string;
  status: TaskDisplayStatus;
  layer: number;
  x: number;
  y: number;
  dependsOn: string[];
}

interface LayoutEdge {
  source: string;
  target: string;
}

interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  svgWidth: number;
  svgHeight: number;
}

function computeLayout(
  tasks: WorkflowTask[],
  statuses: Record<string, TaskDisplayStatus>,
): LayoutResult {
  if (tasks.length === 0) {
    return { nodes: [], edges: [], svgWidth: 0, svgHeight: 0 };
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const layers = new Map<string, number>();
  const visited = new Set<string>();

  function getLayer(taskId: string, depth = 0): number {
    if (depth > 100) return 0;
    if (layers.has(taskId)) return layers.get(taskId)!;
    if (visited.has(taskId)) return 0;
    visited.add(taskId);

    const task = taskMap.get(taskId);
    if (!task || !task.dependsOn || task.dependsOn.length === 0) {
      layers.set(taskId, 0);
      return 0;
    }

    let maxDepLayer = -1;
    for (const dep of task.dependsOn) {
      if (!taskMap.has(dep)) continue;
      const depLayer = getLayer(dep, depth + 1);
      if (depLayer > maxDepLayer) maxDepLayer = depLayer;
    }
    const layer = maxDepLayer + 1;
    layers.set(taskId, layer);
    return layer;
  }

  for (const task of tasks) {
    getLayer(task.id);
  }

  const layerGroups = new Map<number, string[]>();
  for (const task of tasks) {
    const layer = layers.get(task.id) ?? 0;
    const group = layerGroups.get(layer);
    if (group) {
      group.push(task.id);
    } else {
      layerGroups.set(layer, [task.id]);
    }
  }

  const sortedLayers = [...layerGroups.entries()].sort(([a], [b]) => a - b);

  const maxLayerTaskCount = Math.max(...sortedLayers.map(([, ids]) => ids.length), 1);

  const totalWidth = maxLayerTaskCount * NODE_WIDTH + (maxLayerTaskCount - 1) * H_GAP;

  const positionedNodes: LayoutNode[] = [];

  for (const [layer, taskIds] of sortedLayers) {
    const layerWidth = taskIds.length * NODE_WIDTH + (taskIds.length - 1) * H_GAP;
    const startX = PADDING + Math.max(0, (totalWidth - layerWidth) / 2);

    const sortedTaskIds = [...taskIds].sort((a, b) =>
      (taskMap.get(a)?.title ?? "").localeCompare(taskMap.get(b)?.title ?? ""),
    );

    for (let i = 0; i < sortedTaskIds.length; i++) {
      const taskId = sortedTaskIds[i]!;
      const task = taskMap.get(taskId)!;
      const x = startX + i * (NODE_WIDTH + H_GAP);
      const y = PADDING + layer * (NODE_HEIGHT + V_GAP);

      positionedNodes.push({
        id: taskId,
        title: task.title,
        status: (statuses[taskId] ?? "pending") as TaskDisplayStatus,
        layer,
        x,
        y,
        dependsOn: task.dependsOn ?? [],
      });
    }
  }

  const edges: LayoutEdge[] = [];
  for (const task of tasks) {
    if (!task.dependsOn) continue;
    for (const depId of task.dependsOn) {
      if (taskMap.has(depId)) {
        edges.push({ source: depId, target: task.id });
      }
    }
  }

  const lastLayer = sortedLayers[sortedLayers.length - 1];
  const maxLayer = lastLayer ? lastLayer[0] : 0;
  const svgWidth = PADDING * 2 + totalWidth;
  const svgHeight = PADDING * 2 + (maxLayer + 1) * NODE_HEIGHT + maxLayer * V_GAP;

  return { nodes: positionedNodes, edges, svgWidth, svgHeight };
}

function getEdgePath(source: LayoutNode, target: LayoutNode): string {
  const x1 = source.x + NODE_WIDTH / 2;
  const y1 = source.y + NODE_HEIGHT;
  const x2 = target.x + NODE_WIDTH / 2;
  const y2 = target.y;
  const cy = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "\u2026";
}

export function WorkflowGraph({
  tasks,
  taskStatuses = {},
  selectedTaskId = null,
  onTaskClick,
  onTaskDoubleClick,
  emptyMessage = "No tasks to display",
}: WorkflowGraphProps) {
  const layout = useMemo(() => computeLayout(tasks, taskStatuses), [tasks, taskStatuses]);

  const nodeMap = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout.nodes]);

  const handleKeyDown = useCallback(
    (taskId: string) => (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onTaskClick?.(taskId);
      }
    },
    [onTaskClick],
  );

  if (layout.nodes.length === 0) {
    return (
      <div
        role="region"
        aria-label="Workflow graph"
        style={{
          padding: "48px 24px",
          textAlign: "center",
          color: "#6b7280",
          fontSize: 14,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  const nodeColors = (status: string): NodeColors =>
    (STATUS_COLORS[status] ?? DEFAULT_COLORS) as NodeColors;

  return (
    <div role="region" aria-label="Workflow graph">
      <svg
        width={layout.svgWidth}
        height={layout.svgHeight}
        viewBox={`0 0 ${layout.svgWidth} ${layout.svgHeight}`}
        role="tree"
        aria-label="Workflow task graph"
        style={{ maxWidth: "100%", height: "auto" }}
      >
        <defs>
          <marker id="arrowhead" markerWidth={8} markerHeight={6} refX={8} refY={3} orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
          </marker>
        </defs>

        {layout.edges.map((edge) => {
          const source = nodeMap.get(edge.source);
          const target = nodeMap.get(edge.target);
          if (!source || !target) return null;
          return (
            <path
              key={`edge-${edge.source}-${edge.target}`}
              d={getEdgePath(source, target)}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
          );
        })}

        {layout.nodes.map((node) => {
          const colors = nodeColors(node.status);
          const isSelected = node.id === selectedTaskId;

          return (
            <g
              key={node.id}
              role="treeitem"
              tabIndex={0}
              aria-label={`Task: ${node.title} (${node.status})`}
              aria-selected={isSelected}
              onClick={() => onTaskClick?.(node.id)}
              onDoubleClick={() => onTaskDoubleClick?.(node.id)}
              onKeyDown={handleKeyDown(node.id)}
              style={{ cursor: "pointer", outline: "none" }}
            >
              <rect
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                ry={6}
                fill={colors.fill}
                stroke={isSelected ? "#2563eb" : colors.stroke}
                strokeWidth={isSelected ? 3 : 1.5}
              />
              <text
                x={node.x + NODE_WIDTH / 2}
                y={node.y + 22}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={colors.text}
                fontSize={13}
                fontWeight={600}
                fontFamily="system-ui, sans-serif"
              >
                {truncateText(node.title, 22)}
              </text>
              <text
                x={node.x + NODE_WIDTH / 2}
                y={node.y + 38}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={colors.text}
                fontSize={11}
                fontFamily="system-ui, sans-serif"
              >
                {node.status}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
