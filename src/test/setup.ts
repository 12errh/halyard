import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom implements neither of these, and the composer/markdown rely on both.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom implements neither scrollIntoView nor CSS.escape, both of which the
// tab strip and command palette call on mount.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
if (!globalThis.CSS?.escape) {
  globalThis.CSS = Object.assign(globalThis.CSS ?? {}, {
    escape: (value: string) => value.replace(/[^\w-]/g, (ch) => `\\${ch}`),
  }) as typeof CSS;
}

// Tauri's APIs are not present under Vitest. The app talks to them through
// `src/lib/tauri.ts`, so stubbing the module keeps component tests honest
// about what they depend on.
vi.mock("@/lib/tauri", () => ({
  api: {
    startServer: vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:4096",
      port: 4096,
      version: "1.18.35",
      project: "/tmp/project",
    }),
    stopServer: vi.fn().mockResolvedValue(undefined),
    serverStatus: vi.fn().mockResolvedValue({ status: "stopped" }),
    getSettings: vi.fn().mockResolvedValue({
      recentProjects: [],
      lastProject: null,
      binaryOverride: null,
    }),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    rememberProject: vi.fn().mockResolvedValue({
      recentProjects: [],
      lastProject: null,
      binaryOverride: null,
    }),
    forgetProject: vi.fn().mockResolvedValue({
      recentProjects: [],
      lastProject: null,
      binaryOverride: null,
    }),
  },
  onServerStatus: vi.fn().mockResolvedValue(vi.fn()),
  onServerLog: vi.fn().mockResolvedValue(vi.fn()),
  onOpenRequest: vi.fn().mockResolvedValue(vi.fn()),
  EVENT_SERVER_STATUS: "halyard://server-status",
  EVENT_SERVER_LOG: "halyard://server-log",
  EVENT_OPEN: "halyard://open",
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));
