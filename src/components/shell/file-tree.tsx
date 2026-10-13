import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronRight,
  File as FileIcon,
  FileCode,
  FolderOpen,
  Folder,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openPath } from "@tauri-apps/plugin-opener";
import { OpencodeClient, type FileNode } from "@/lib/opencode/client";
import { useServer } from "@/state/server";
import { cn } from "@/lib/utils";

const CODE_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "py", "go", "java", "kt", "swift",
  "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "bash", "zsh", "json", "toml",
  "yaml", "yml", "md", "mdx", "css", "scss", "html", "sql", "vue", "svelte", "lua",
]);

interface Directory {
  path: string;
  nodes: FileNode[];
  loading: boolean;
}

/**
 * Working-tree browser.
 *
 * Read-only by design: this slice ships an observe-only review workflow, so the
 * tree navigates and opens files in the OS editor rather than editing in place.
 * Directories load lazily, because walking a monorepo root eagerly is slow.
 */
export function FileTree() {
  const [root, setRoot] = useState<Directory | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, Directory>>({});
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (path?: string) => {
    try {
      setError(null);
      if (!path) {
        const nodes = await loadChildren("");
        setRoot({ path: "", nodes, loading: false });
        setExpanded(new Set());
        setChildren({});
        return;
      }
      const nodes = await loadChildren(path);
      setChildren((prev) => ({ ...prev, [path]: { path, nodes, loading: false } }));
    } catch (cause) {
      setError((cause as Error).message || "could not list files");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (node: FileNode) => {
    const isDirectory = node.type === "directory" || node.type === "dir";
    if (!isDirectory) return;
    const next = new Set(expanded);
    if (next.has(node.path)) {
      next.delete(node.path);
    } else {
      next.add(node.path);
      if (!children[node.path]) {
        void (async () => {
          setChildren((prev) => ({
            ...prev,
            [node.path]: { path: node.path, nodes: [], loading: true },
          }));
          try {
            const nodes = await loadChildren(node.path);
            setChildren((prev) => ({ ...prev, [node.path]: { path: node.path, nodes, loading: false } }));
          } catch {
            setChildren((prev) => ({
              ...prev,
              [node.path]: { path: node.path, nodes: [], loading: false },
            }));
          }
        })();
      }
    }
    setExpanded(next);
  };

  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-2">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter files"
          className="h-7 text-[0.78rem]"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void load()}
          aria-label="Refresh file tree"
        >
          <RefreshCw size={12} />
        </Button>
      </div>

      <div className="scroll-area flex-1 py-1">
        {error && <p className="px-3 py-2 text-[0.76rem] text-danger">{error}</p>}

        {root?.loading && (
          <p className="px-3 py-2 text-[0.76rem] text-ink-ghost">loading…</p>
        )}

        <ul>
          {visible(root?.nodes ?? [], filter).map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              children={children}
              filter={filter}
              onToggle={toggle}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  children,
  filter,
  onToggle,
}: {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  children: Record<string, Directory>;
  filter: string;
  onToggle(node: FileNode): void;
}) {
  const directory = isDir(node);
  const isOpen = expanded.has(node.path);
  const loaded = children[node.path];

  // While filtering we still expand, so matches deeper in the tree are visible.
  const showChildren = directory && (isOpen || filter.trim().length > 0);
  const Icon = directory ? (isOpen ? FolderOpen : Folder) : codeFile(node.name) ? FileCode : FileIcon;

  return (
    <li>
      <button
        type="button"
        onClick={() => (directory ? onToggle(node) : void openPath(node.absolute).catch(() => undefined))}
        title={node.path}
        className={cn(
          "flex w-full items-center gap-1 py-[3px] pr-2 text-left text-[0.78rem] transition-colors",
          "text-ink-muted hover:bg-raised hover:text-ink",
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {directory ? (
          <ChevronRight
            size={11}
            className={cn("shrink-0 text-ink-ghost transition-transform duration-150", isOpen && "rotate-90")}
          />
        ) : (
          <span className="w-[11px] shrink-0" />
        )}
        <Icon size={12} className="shrink-0 text-ink-ghost" />
        <span className="truncate">{node.name}</span>
        {node.ignored && <span className="ml-auto shrink-0 text-[0.62rem] text-ink-ghost">ignored</span>}
      </button>

      <AnimatePresence initial={false}>
        {showChildren && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            {loaded?.loading && <li className="py-0.5 text-[0.7rem] text-ink-ghost" style={{ paddingLeft: 30 + depth * 12 }}>loading…</li>}
            {visible(loaded?.nodes ?? [], filter).map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                children={children}
                filter={filter}
                onToggle={onToggle}
              />
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </li>
  );
}

function visible(nodes: FileNode[], filter: string): FileNode[] {
  const sorted = [...nodes].sort((a, b) => {
    const dirA = isDir(a) ? 0 : 1;
    const dirB = isDir(b) ? 0 : 1;
    return dirA !== dirB ? dirA - dirB : a.name.localeCompare(b.name);
  });
  if (!filter.trim()) return sorted;
  const needle = filter.trim().toLowerCase();
  return sorted.filter((node) => node.name.toLowerCase().includes(needle));
}

function isDir(node: FileNode): boolean {
  return node.type === "directory" || node.type === "dir";
}

function codeFile(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return CODE_EXTENSIONS.has(ext);
}

async function loadChildren(path: string): Promise<FileNode[]> {
  const phase = useServer.getState().phase;
  if (phase.kind !== "ready") return [];
  return new OpencodeClient(phase.info.url).listFiles(path);
}

