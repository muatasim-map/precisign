/** Short, readable request ID for display. The full ID stays available for copying and links. */
export function formatRequestId(id: string, displayId?: string): string {
  if (displayId && displayId.trim()) return displayId.trim();
  const parts = id.split('-');
  if (parts.length >= 7) {
    return `${parts.slice(0, 3).join('-')}-${parts[3].slice(0, 4)}…${parts[parts.length - 1].slice(-4)}`;
  }
  return id;
}
