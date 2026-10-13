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

export interface ConfigFile {
  path: string;
  content: string;
  exists: boolean;
}

export interface ExportResult {
  path: string;
  bytes: number;
}

export const api = {
  readConfigFile: (directory: string) => invoke<ConfigFile>("read_config_file", { directory }),

  writeConfigFile: (path: string, content: string) =>
    invoke<void>("write_config_file", { path, content }),

  globalConfig: () => invoke<ConfigFile>("global_config"),

  validateConfig: (content: string) => invoke<void>("validate_config", { content }),

  exportSession: (sessionId: string, path: string, binaryOverride: string | null) =>
    invoke<ExportResult>("export_session", { sessionId, path, binaryOverride }),

  importSession: (path: string, binaryOverride: string | null) =>
    invoke<boolean>("import_session", { path, binaryOverride }),

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
