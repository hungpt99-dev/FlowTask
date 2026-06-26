export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) {
    const secs = Math.floor(ms / 1000);
    return `${secs}s`;
  }
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export function formatTimeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return "just now";
  if (diff < 60000) return "just now";
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}
