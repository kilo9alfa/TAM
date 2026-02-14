import { ActivityRecord } from "./types";

/** Check if a terminal had any activity since midnight local time */
export function isActiveToday(record: ActivityRecord): boolean {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return record.lastActivity >= midnight.getTime();
}

/** Format a timestamp: HH:MM for today, relative for older */
export function formatRelativeTime(epochMs: number): string {
  const date = new Date(epochMs);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  if (epochMs >= midnight.getTime()) {
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }

  const now = Date.now();
  const diffMs = now - epochMs;
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
