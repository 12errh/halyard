import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./code-block";

/**
 * Markdown renderer for assistant output.
 *
 * Raw HTML is intentionally not enabled (`rehype-raw` is absent). Model output
 * is untrusted input, and permitting raw HTML here would be a script injection
 * path into a shell that has filesystem access.
 */
export const Markdown = memo(function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components(streaming)}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

function components(streaming: boolean): Components {
  return {
    code({ className, children, ...props }) {
      // Fenced blocks arrive as `language-xxx` on the className; inline code
      // has none and must stay inline.
      const language = /language-([\w+-]+)/.exec(className ?? "")?.[1];
      const text = String(children ?? "");

      if (!language && !text.includes("\n")) {
        return (
          <code className="rounded-[4px] border border-line bg-raised px-[4px] py-px font-mono text-[0.85em] text-accent-hover" {...props}>
            {children}
          </code>
        );
      }

      return <CodeBlock code={text.replace(/\n$/, "")} language={language} streaming={streaming} />;
    },

    pre({ children }) {
      // The CodeBlock renders its own <pre>; drop the wrapper to avoid nesting.
      return <>{children}</>;
    },

    a({ href, children, ...props }) {
      return (
        <a
          href={href}
          {...props}
          onClick={(event) => {
            event.preventDefault();
            if (href) void window.open(href, "external");
          }}
          className="text-accent underline decoration-accent/35 underline-offset-[3px] transition-colors hover:decoration-accent"
        >
          {children}
        </a>
      );
    },

    table({ children }) {
      return (
        <div className="my-3 overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full border-collapse text-[0.82rem]">{children}</table>
        </div>
      );
    },

    th({ children }) {
      return <th className="border-b border-line bg-raised px-2.5 py-1.5 text-left font-medium text-ink-muted">{children}</th>;
    },

    td({ children }) {
      return <td className="border-b border-line/60 px-2.5 py-1.5 align-top">{children}</td>;
    },

    hr() {
      return <hr className="my-4 border-line" />;
    },

    blockquote({ children }) {
      return (
        <blockquote className="my-2.5 border-l-2 border-accent/45 pl-3 text-ink-muted">
          {children}
        </blockquote>
      );
    },

    ul({ children }) {
      return <ul className="my-1.5 list-disc space-y-1 pl-5 marker:text-ink-ghost">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="my-1.5 list-decimal space-y-1 pl-5 marker:text-ink-ghost">{children}</ol>;
    },
    li({ children }) {
      return <li className="pl-0.5">{children as ReactNode}</li>;
    },
  };
}
