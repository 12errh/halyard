import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Clamp text to `max` characters, breaking on a word boundary. */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const slice = value.slice(0, max);
  const boundary = slice.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? slice.slice(0, boundary) : slice).trimEnd()}…`;
}

/** Final path segment of a directory, used as the project display name. */
export function projectName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Shorten an absolute path for display, keeping the tail readable. */
export function shortenPath(path: string, segments = 2): string {
  const parts = path.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= segments) return path;
  return `…/${parts.slice(-segments).join("/")}`;
}
