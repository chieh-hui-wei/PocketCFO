/**
 * src/utils/formatters.ts
 * Shared formatting utilities for the PocketCFO frontend.
 */

/**
 * Parse an ISO datetime string that may or may not carry a timezone indicator,
 * treating bare strings (no Z / no +offset) as UTC, then return a Date object
 * already shifted to UTC+8 (Taiwan Standard Time).
 */
export function parseUtcToTST(isoString: string): Date {
  let clean = isoString.trim();
  // Normalise "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SS"
  if (clean.includes(" ") && !clean.includes("T")) {
    clean = clean.replace(" ", "T");
  }
  // If there is no timezone suffix, treat the timestamp as UTC
  if (!clean.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(clean)) {
    clean = clean + "Z";
  }
  return new Date(clean);
}

/**
 * Format a UTC timestamp string as a human-readable date-time in UTC+8 / TST.
 *
 * @param isoString  - The ISO datetime string from the API (UTC, no timezone marker).
 * @param showSeconds - Whether to include the seconds component (default false).
 * @returns Formatted string like "2026年07月07日 22:30" or "" if invalid.
 */
export function formatUtc8(isoString?: string | null, showSeconds = false): string {
  if (!isoString) return "";
  try {
    const d = parseUtcToTST(isoString);
    if (isNaN(d.getTime())) return "";

    // Use Intl.DateTimeFormat with explicit timezone for reliable TST output
    const fmt = new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      ...(showSeconds ? { second: "2-digit" } : {}),
      hour12: false,
    });

    // Intl.DateTimeFormat returns e.g. "2026/07/07 22:30" in zh-TW
    const parts = fmt.formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

    const y = get("year");
    const m = get("month");
    const day = get("day");
    const h = get("hour");
    const min = get("minute");
    const sec = get("second");

    return showSeconds
      ? `${y}年${m}月${day}日 ${h}:${min}:${sec}`
      : `${y}年${m}月${day}日 ${h}:${min}`;
  } catch {
    return "";
  }
}
