/**
 * Shiki-backed syntax highlighting.
 *
 * A single highlighter is created lazily with a curated language set. Loading
 * every grammar Shiki ships would add megabytes to the WebKitGTK webview for
 * languages this app will realistically never see, and streaming text means the
 * highlighter is on the hot path.
 */

import type { Highlighter } from "shiki";

const LANGS = [
  "bash",
  "c",
  "cpp",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "kotlin",
  "lua",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "scss",
  "shell",
  "sql",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "xml",
  "yaml",
] as const;

export type Lang = (typeof LANGS)[number];

const ALIASES: Record<string, Lang> = {
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  fish: "bash",
  console: "bash",
  ts: "typescript",
  js: "javascript",
  jsx: "jsx",
  tsx: "tsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  "c++": "cpp",
  golang: "go",
  yuv: "yaml",
  dockerfile: "bash",
};

export function normaliseLang(raw: string | undefined): Lang | "text" {
  if (!raw) return "text";
  const key = raw.toLowerCase().trim();
  if (ALIASES[key]) return ALIASES[key];
  const direct = LANGS.find((lang) => lang === key);
  return direct ?? "text";
}

let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighter }, theme] = await Promise.all([
      import("shiki"),
      import("./theme"),
    ]);
    return createHighlighter({
      themes: [theme.halyardTheme],
      langs: [...LANGS],
    });
  })();
  return highlighterPromise;
}

const cache = new Map<string, string>();

/**
 * Highlight `code`, returning HTML. Results are memoised because streaming
 * re-renders the same completed blocks constantly.
 */
export async function highlight(code: string, lang: string): Promise<string> {
  const resolved = normaliseLang(lang);
  const key = `${resolved}::${code}`;
  const cached = cache.get(key);
  if (cached) return cached;

  try {
    const highlighter = await getHighlighter();
    const html = highlighter.codeToHtml(code, {
      lang: resolved,
      theme: "halyard-dark",
    });
    if (cache.size > 200) cache.clear();
    cache.set(key, html);
    return html;
  } catch {
    // Highlighting must never blank out the user's code.
    const escaped = code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre class="shiki"><code>${escaped}</code></pre>`;
  }
}

/** Warm the highlighter during idle time so the first code block is not slow. */
export function preloadHighlighter() {
  const run = () => void getHighlighter();
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
  } else {
    setTimeout(run, 400);
  }
}
