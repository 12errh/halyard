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
  showTray: boolean;
  closeToTray: boolean;
  notifyOnFinish: boolean;
}

export const EVENT_SERVER_STATUS = "halyard://server-status";
export const EVENT_SERVER_LOG = "halyard://server-log";
export const EVENT_OPEN = "halyard://open";
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

/** A newer release, or `null` when there is nothing to install. */
export interface UpdateSummary {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export const EVENT_UPDATE_PROGRESS = "halyard://update-progress";

/**
 * Check for a newer release.
 *
 * Resolves to `null` both when the app is current and when this install cannot
 * update itself — a `.deb` has no self-update path, because replacing a system
 * package means writing to `/usr`, which only root can do. `updateSupport()`
 * is what tells the two apart, so the UI can explain rather than sit silent.
 */
export const checkForUpdate = () => invoke<UpdateSummary | null>("check_for_update");

/**
 * Whether this install can replace itself, and why not if it cannot.
 *
 * `checkForUpdate` answering `null` is ambiguous on its own — up to date, or
 * unable to update. This is what disambiguates it.
 */
export interface UpdateSupport {
  canSelfUpdate: boolean;
  reason: string | null;
  currentVersion: string;
}

export const updateSupport = () => invoke<UpdateSupport>("update_support");

/**
 * Download, verify, install, and relaunch.
 *
 * The signature is checked against the key compiled into the app, so this
 * refuses rather than installs anything tampered with in transit.
 */
export const installUpdate = () => invoke<void>("install_update");

export function onUpdateProgress(
  handler: (progress: UpdateProgress) => void,
): Promise<UnlistenFn> {
  return listen<UpdateProgress>(EVENT_UPDATE_PROGRESS, (event) => handler(event.payload));
}

export function onServerStatus(
  handler: (status: ServerStatus) => void,
): Promise<UnlistenFn> {
  return listen<ServerStatus>(EVENT_SERVER_STATUS, (event) => handler(event.payload));
}

export function onServerLog(handler: (line: ServerLogLine) => void): Promise<UnlistenFn> {
  return listen<ServerLogLine>(EVENT_SERVER_LOG, (event) => handler(event.payload));
}

/** Which tray menu item was used to summon the window. */
export type OpenRequest = { action: "window" } | { action: "newThread" } | { action: "settings" };

export function onOpenRequest(handler: (request: OpenRequest) => void): Promise<UnlistenFn> {
  return listen<OpenRequest>(EVENT_OPEN, (event) => handler(event.payload));
}
