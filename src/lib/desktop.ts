/**
 * Native shell integration: notifications, taskbar attention, autostart.
 *
 * Split from `tauri.ts` on purpose. Those calls are fire-and-forget and must
 * never be able to break the app — a desktop without a notification daemon
 * should quietly lose the notification, not the running agent. Everything here
 * therefore swallows its own errors and reports success as a boolean, so the
 * caller can carry on regardless.
 */

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

/**
 * Whether we are running inside a real Tauri webview.
 *
 * The Vite dev server is also opened in an ordinary browser during frontend
 * work, where none of these APIs exist. Checking first keeps that from throwing.
 */
function native(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True when the window is on screen and has focus. */
export async function windowIsFocused(): Promise<boolean> {
  if (!native()) return true;
  try {
    return await getCurrentWindow().isFocused();
  } catch {
    // Assume focused: better to skip a notification than to interrupt.
    return true;
  }
}

export async function hideWindow(): Promise<void> {
  if (!native()) return;
  try {
    await getCurrentWindow().hide();
  } catch {
    /* the tray is the fallback, and it always works */
  }
}

export async function showWindow(): Promise<void> {
  if (!native()) return;
  try {
    const window = getCurrentWindow();
    await window.unminimize();
    await window.show();
    await window.setFocus();
  } catch {
    /* nothing useful to do if the platform refuses */
  }
}

/**
 * Show or clear the taskbar/dock attention marker.
 *
 * Delegated to Rust because the three desktops disagree: macOS and Linux take
 * a badge count, Windows has no number at all and needs an overlay icon.
 */
export async function setAttention(count: number): Promise<void> {
  if (!native()) return;
  try {
    await invoke("set_attention_command", { count });
  } catch {
    /* decoration only */
  }
}

/**
 * Ask for notification permission once, then notify.
 *
 * Returns whether a notification was actually shown, so the caller can fall
 * back to a badge rather than assuming the user was told.
 */
export async function notify(title: string, body: string): Promise<boolean> {
  if (!native()) return false;

  let granted = false;
  try {
    granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === "granted";
  } catch {
    return false;
  }
  if (!granted) return false;

  try {
    sendNotification({ title, body });
    return true;
  } catch {
    return false;
  }
}

/** Whether the app is registered to launch at login. */
export async function autostartEnabled(): Promise<boolean> {
  if (!native()) return false;
  try {
    return await isEnabled();
  } catch {
    return false;
  }
}

export async function setAutostart(enabled: boolean): Promise<boolean> {
  if (!native()) return false;
  try {
    if (enabled) await enable();
    else await disable();
    return true;
  } catch {
    return false;
  }
}

/** The payload behind the tray's "Open Halyard" event. */
export interface OpenRequest {
  action: "window" | "newThread" | "settings";
}
