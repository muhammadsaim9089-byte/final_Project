"use client";

import { createContext, useContext } from "react";
import type { LineageResult } from "@/lib/model/lineage";
import { EMPTY_HUBS, type HubInfo } from "@/lib/model/hubs";

export type DetailsLevelValue = "all" | "keys" | "headers";

export interface DisplayState {
  readOnly?: boolean;
  detailsLevel: DetailsLevelValue;
  /** Active lineage trace (a focused column/table and everything upstream/downstream), or null. */
  lineage: LineageResult | null;
  lineageFocus: { tableId: string; column?: string } | null;
  /** Tables (ids) that take part in at least one Dep edge — their columns become clickable. */
  lineageTables: Set<string>;
  /** Names of existing table groups (for the group picker in the table toolbar). */
  groupNames: string[];
  onColumnClick: (tableId: string, column: string) => void;
  clearLineage: () => void;
  /** Called with a table id + optional column to jump to its DBML definition. */
  onReveal: (tableId: string, column?: string) => void;
  /** Hub tables and who references them (lib/model/hubs) — stable while only positions change. */
  hubs: HubInfo;
  /** whether lines to hub tables are drawn (otherwise the referencing tables show badges) */
  hubEdgesShown: boolean;
  /** Brings a table into view and flashes it (a hub badge's click). */
  onGoToTable: (tableId: string) => void;
  /** The group whose frame a dragged table would join if dropped now (the frame lights up), or null. */
  dropGroup: string | null;
  /** Moves a table into a group ("" takes it out) — one undo step, the frame kept clear of other tables. */
  onSetTableGroup: (tableId: string, group: string) => void;
}

const noop = () => undefined;

export const DisplayContext = createContext<DisplayState>({
  readOnly: false,
  detailsLevel: "all",
  lineage: null,
  lineageFocus: null,
  lineageTables: new Set(),
  groupNames: [],
  onColumnClick: noop,
  clearLineage: noop,
  onReveal: noop,
  hubs: EMPTY_HUBS,
  hubEdgesShown: false,
  onGoToTable: noop,
  dropGroup: null,
  onSetTableGroup: noop,
});

export const useDisplay = () => useContext(DisplayContext);
