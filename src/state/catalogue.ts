/**
 * The command and skill catalogue, fetched once per server.
 *
 * These used to be fetched from inside the composer's keystroke handler, so
 * typing `/` fired a request, every further character fired another, and the
 * menu was empty for as long as that request took — which reads as "the app has
 * three commands" and then, worse, as "it has none" when the request failed.
 *
 * The list changes only when opencode's own catalogue changes, so it is fetched
 * once when the server comes up, kept here, and filtered in memory after that.
 * The SSE events that mean "something changed" invalidate it.
 */

import { create } from "zustand";
import type { OpencodeClient } from "@/lib/opencode/client";
import { groupResources, type Skill } from "@/lib/resources";
import type { ServerEvent } from "@/lib/opencode/types";

export interface CommandSuggestion {
  value: string;
  label: string;
  hint?: string;
  kind: "command";
  /** `command` vs `skill`; used to group the list under headings. */
  source?: string;
  /** Set on the entry that opens the skill picker instead of inserting text. */
  opens?: "skills";
}

/** Events after which the catalogue may no longer be complete. */
const INVALIDATORS = new Set([
  "catalog.updated",
  "integration.updated",
  "plugin.added",
  "installation.updated",
  "command.updated",
]);

interface CatalogueStore {
  commands: CommandSuggestion[];
  skills: Skill[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  client: OpencodeClient | null;

  setClient(client: OpencodeClient | null): void;
  /** Fetch if not already fetched for this server. Safe to call per keystroke. */
  load(): Promise<void>;
  refresh(): Promise<void>;
  ingest(event: ServerEvent): void;
}

export const useCatalogue = create<CatalogueStore>((set, get) => {
  let inFlight: Promise<void> | null = null;

  const fetchOnce = async (client: OpencodeClient) => {
    // Settled rather than all: a server with skills but no command list is
    // still worth something, and a swallowed failure is how an empty menu came
    // to be read as "this server has three commands".
    const [rawCommands, rawResources] = await Promise.allSettled([
      client.commands(),
      client.resources(),
    ]);

    const failed: string[] = [];
    if (rawCommands.status === "rejected") failed.push("commands");
    if (rawResources.status === "rejected") failed.push("skills");

    const skills =
      rawResources.status === "fulfilled" ? groupResources(rawResources.value).skills : [];

    const commands: CommandSuggestion[] =
      rawCommands.status === "fulfilled"
        ? rawCommands.value.map((command) => ({
            value: command.name,
            label: command.name,
            hint: command.description,
            source: command.source,
            kind: "command",
          }))
        : [];

    // opencode lists a skill as a command of its own, which is true and not
    // what anyone means by "show me the skills" — that is one search over all
    // of them. It goes first because it is the one worth reaching for.
    const picker: CommandSuggestion = {
      value: "skill",
      label: "skill",
      hint: "Search and add skills",
      kind: "command",
      opens: "skills",
    };

    set({
      commands: [picker, ...commands],
      skills,
      loaded: true,
      loading: false,
      error: failed.length > 0 ? `could not load ${failed.join(" and ")}` : null,
    });
  };

  const load = async () => {
    const { client, loaded, loading } = get();
    if (!client || loaded || loading) return inFlight ?? undefined;
    set({ loading: true });
    inFlight = fetchOnce(client)
      .catch((error: unknown) => {
        // Leave the menu empty but say why, so a failure is not mistaken for
        // "this server has no commands".
        set({
          loaded: true,
          loading: false,
          error: (error as Error)?.message ?? "could not load commands",
        });
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    commands: [],
    skills: [],
    loaded: false,
    loading: false,
    error: null,
    client: null,

    setClient: (client) => {
      const previous = get().client;
      if (previous === client) return;
      // A different server is a different catalogue. Keeping the old one would
      // offer commands this project does not have.
      set({ commands: [], skills: [], loaded: false, loading: false, error: null, client });
    },

    load,

    refresh: async () => {
      const client = get().client;
      if (!client) return;
      set({ loaded: false, loading: false });
      await load();
    },

    ingest: (event) => {
      if (!INVALIDATORS.has(event.type)) return;
      const client = get().client;
      if (!client) return;
      set({ loaded: false });
      void load();
    },
  };
});
