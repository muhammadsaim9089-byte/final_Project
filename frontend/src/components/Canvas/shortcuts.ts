/**
 * Every keyboard shortcut and gesture in one place — the `?` cheat sheet (ShortcutsModal) and the top bar's Help menu
 * both read from here, so a new shortcut only has to be added once. Keys are written for Windows / Linux ("Ctrl");
 * `keyLabel` shows ⌘ / ⌥ on a Mac.
 */

export interface Shortcut {
  keys: string[];
  description: string;
}

export interface ShortcutCategory {
  title: string;
  items: Shortcut[];
}

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: "General",
    items: [
      { keys: ["Ctrl", "K"], description: "Search tables, columns, groups, enums and commands" },
      { keys: ["?"], description: "Show or hide this cheat sheet" },
      { keys: ["Ctrl", "S"], description: "Save the diagram" },
      { keys: ["Ctrl", "\\"], description: "Show / hide the code panel" },
      { keys: ["Ctrl", "I"], description: "Open the Import dialog" },
      { keys: ["Esc"], description: "Close the open dialog, menu, search or drawer" },
    ],
  },
  {
    title: "Canvas",
    items: [
      { keys: ["Ctrl", "Z"], description: "Undo the last change" },
      { keys: ["Ctrl", "Y"], description: "Redo (also Ctrl + Shift + Z)" },
      { keys: ["Ctrl", "C"], description: "Copy the selected tables — paste them into any diagram" },
      { keys: ["Ctrl", "X"], description: "Cut the selected tables" },
      { keys: ["Ctrl", "V"], description: "Paste tables (or DBML text)" },
      { keys: ["Ctrl", "Click"], description: "Add a table to the selection · on a column: jump to it in the DBML code" },
      { keys: ["Shift", "Drag"], description: "Box-select several tables" },
      { keys: ["Ctrl", "G"], description: "Group the selected tables (or add them to an existing group)" },
      { keys: ["Del"], description: "Delete the selection — asks first, naming what goes (Enter deletes, Esc keeps)" },
      { keys: ["Dbl-click"], description: "A table opens its editor · a note or a group's title edits it" },
      { keys: ["Drag"], description: "Column → column creates a foreign key (a data dependency in Draw dependency mode)" },
      { keys: ["Drop"], description: "A table dropped onto a group's frame joins that group" },
      { keys: ["Click"], description: "A column that has lineage traces it upstream and downstream" },
      { keys: ["1 – 6"], description: "Auto arrange menu open: Domains · Left-right · Pipeline · Snowflake · Compact · Top-bottom" },
      { keys: ["Enter"], description: "Auto arrange: confirm the rearrangement (Esc cancels)" },
    ],
  },
  {
    title: "Panels and notes",
    items: [
      { keys: ["Esc"], description: "Groups / Lineage drawer: stop Draw dependency, cancel an edit, then close" },
      { keys: ["Enter"], description: "Selection bar: create the group you named" },
      { keys: ["Ctrl", "Enter"], description: "Sticky note: finish editing" },
      { keys: ["↑ ↓"], description: "Search: move through the results (Enter opens one)" },
    ],
  },
  {
    title: "Code editor (DBML)",
    items: [
      { keys: ["Ctrl", "/"], description: "Toggle line comment" },
      { keys: ["Shift", "Alt", "A"], description: "Toggle block comment" },
      { keys: ["Ctrl", "Click"], description: "Jump from a table name to it on the canvas" },
      { keys: ["Ctrl", "F12"], description: "Jump to the table under the cursor on the canvas" },
      { keys: ["Ctrl", "Space"], description: "Autocomplete tables, columns and types" },
      { keys: ["Ctrl", "F"], description: "Find (and replace) in the editor" },
      { keys: ["Ctrl", "Shift", "["], description: "Fold the block (Ctrl + Shift + ] unfolds; on a Mac ⌘ ⌥ [ and ])" },
      { keys: ["Tab"], description: "Indent (Shift + Tab outdents)" },
    ],
  },
  {
    title: "SQL playground",
    items: [
      { keys: ["Ctrl", "Enter"], description: "Run every statement — or just the selected SQL" },
      { keys: ["Alt", "Enter"], description: "Switch between the docked panel and the full-screen IDE" },
      { keys: ["Esc"], description: "Full screen → docked panel → close (your query is kept)" },
      { keys: ["Click"], description: "A table or column in the schema inserts its name (Shift: table.column)" },
      { keys: ["Ctrl", "Space"], description: "Autocomplete tables, columns and keywords" },
    ],
  },
  {
    title: "Dashboard",
    items: [{ keys: ["/"], description: "Jump to the search box" }],
  },
];

/** The handful the Help menu lists; the rest are a click away in the cheat sheet. */
export const HELP_MENU_SHORTCUTS: { label: string; keys: string[] }[] = [
  { label: "Search everything", keys: ["Ctrl", "K"] },
  { label: "Save diagram", keys: ["Ctrl", "S"] },
  { label: "Undo / redo", keys: ["Ctrl", "Z / Y"] },
  { label: "Copy / paste tables", keys: ["Ctrl", "C / V"] },
  { label: "Select several tables", keys: ["Ctrl", "Click"] },
  { label: "Group selected tables", keys: ["Ctrl", "G"] },
  { label: "Show / hide code panel", keys: ["Ctrl", "\\"] },
  { label: "Import", keys: ["Ctrl", "I"] },
  { label: "Comment line (DBML)", keys: ["Ctrl", "/"] },
];

/** Asks the canvas to open the cheat sheet (the Help menu's "All shortcuts"). */
export const OPEN_SHORTCUTS_EVENT = "designdb:open-shortcuts";

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Ctrl" → "⌘" and "Alt" → "⌥" on a Mac; everything else as written. */
export function keyLabel(key: string): string {
  if (!isMac()) return key;
  if (key === "Ctrl") return "⌘";
  if (key === "Alt") return "⌥";
  return key;
}
