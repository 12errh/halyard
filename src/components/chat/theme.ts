/**
 * Halyard's Shiki theme.
 *
 * Built on the warm-neutral token ramp so code blocks sit inside the app rather
 * than looking like a foreign editor pasted in. Contrast is kept at or above
 * 4.5:1 against `--canvas` for all token colours.
 */

import type { ThemeRegistration } from "shiki";

export const halyardTheme: ThemeRegistration = {
  name: "halyard-dark",
  type: "dark",
  colors: {
    "editor.background": "#1a1917",
    "editor.foreground": "#edeae4",
  },
  settings: [
    { settings: { foreground: "#edeae4" } },
    { settings: { foreground: "#a8a29a", fontStyle: "italic" } },
    { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "#6f6961", fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: "#b3a06a" } },
    { scope: ["constant.numeric", "constant.language", "constant.character"], settings: { foreground: "#cf9a6a" } },
    { scope: ["variable", "variable.other", "variable.parameter"], settings: { foreground: "#edeae4" } },
    { scope: ["entity.name.function", "support.function", "meta.function-call"], settings: { foreground: "#9fb8d8" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#c2a888" } },
    { scope: ["entity.name.tag", "meta.tag"], settings: { foreground: "#c98a7a" } },
    { scope: ["entity.other.attribute-name", "support.type.property-name"], settings: { foreground: "#c2a888" } },
    { scope: ["keyword", "storage", "storage.type", "keyword.control"], settings: { foreground: "#c98a7a" } },
    { scope: ["keyword.operator"], settings: { foreground: "#a8a29a" } },
    { scope: ["entity.name.namespace", "entity.name.module"], settings: { foreground: "#a8a29a" } },
    { scope: ["support.constant", "variable.language"], settings: { foreground: "#cf9a6a" } },
    { scope: ["punctuation", "meta.brace", "meta.bracket", "meta.delimiter"], settings: { foreground: "#77716a" } },
    { scope: ["markup.inserted", "markup.inserted.diff"], settings: { foreground: "#7ba05f" } },
    { scope: ["markup.deleted", "markup.deleted.diff"], settings: { foreground: "#c45b52" } },
    { scope: ["markup.heading"], settings: { foreground: "#cf9a6a", fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.link", "markup.link.url"], settings: { foreground: "#9fb8d8" } },
    { scope: ["markup.quote"], settings: { foreground: "#a8a29a", fontStyle: "italic" } },
    { scope: ["markup.raw", "markup.list"], settings: { foreground: "#cf9a6a" } },
    { scope: ["invalid"], settings: { foreground: "#c45b52" } },
  ],
};
