/**
 * Typed wrappers around the Rust commands and events.
 *
 * Every `invoke` in the app goes through here so the wire format is declared
 * once, and so tests can stub a single module instead of Tauri itself.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ServerInfo {
  url: string;
  port: number;
  version: string;
  project: string;
}

export type ServerStatus =
  | { status: "stopped" }
  | { status: "starting"; project: string }
  | ({ status: "ready" } & ServerInfo)
  | { status: "failed"; message: string };

export interface Settings {
  recentProjects: string[];
  lastProject: string | null;
  binaryOverride: string | null;
}

export const EVENT_SERVER_STATUS = "halyard://server-status";
export const EVENT_SERVER_LOG = "halyard://server-log";

export interface ServerLogLine {
  level: "info" | "warn" | "stdout" | "stderr";
  message: string;
}

export const api = {
  startServer: (project: string, binaryOverride: string | null) =>
    invoke<ServerInfo>("start_server", { project, binaryOverride }),

  stopServer: () => invoke<void>("stop_server"),

  serverStatus: () => invoke<ServerStatus>("server_status"),

  getSettings: () => invoke<Settings>("get_settings"),

  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),

  rememberProject: (project: string) => invoke<Settings>("remember_project", { project }),

  forgetProject: (project: string) => invoke<Settings>("forget_project", { project }),
};

export function onServerStatus(
  handler: (status: ServerStatus) => void,
): Promise<UnlistenFn> {
  return listen<ServerStatus>(EVENT_SERVER_STATUS, (event) => handler(event.payload));
}

export function onServerLog(handler: (line: ServerLogLine) => void): Promise<UnlistenFn> {
  return listen<ServerLogLine>(EVENT_SERVER_LOG, (event) => handler(event.payload));
}
