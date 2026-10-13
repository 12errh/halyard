import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlight, normaliseLang } from "./highlight";
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  language,
  streaming = false,
}: {
  code: string;
  language?: string;
  streaming?: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    // While tokens are still arriving, skip highlighting entirely — it would
    // re-highlight on every delta and make long answers visibly janky.
    if (streaming) {
      setHtml(null);
      return;
    }
    void highlight(code, language ?? "").then((result) => {
      if (active) setHtml(result);
    });
    return () => {
      active = false;
    };
  }, [code, language, streaming]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be unavailable in a webview without a secure context.
    }
  };

  return (
    <figure
      className={cn(
        "group/code my-2.5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface",
        streaming && "opacity-90",
      )}
    >
      <figcaption className="flex items-center justify-between border-b border-line bg-raised/60 px-2.5 py-1">
        <span className="font-mono text-[0.68rem] uppercase tracking-wider text-ink-faint">
          {normaliseLang(language) === "text" ? "code" : normaliseLang(language)}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy code"
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.68rem] text-ink-faint opacity-0 transition-opacity hover:text-ink group-hover/code:opacity-100 focus-visible:opacity-100"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>

      {html ? (
        <div
          className="code-surface overflow-x-auto px-3 py-2.5 text-[0.8rem] leading-[1.6]"
          // Shiki output is generated locally from the model's own text. There
          // is no untrusted remote input beyond the model response itself, and
          // it contains only spans with inline colour styles.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="code-surface overflow-x-auto px-3 py-2.5 font-mono text-[0.8rem] leading-[1.6] text-ink-muted">
          <code>{code}</code>
        </pre>
      )}
    </figure>
  );
}
