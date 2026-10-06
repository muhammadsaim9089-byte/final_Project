"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, BookOpen, Check, ChevronDown, Clock, Layers, Link2, ListTree, Loader2, MessageSquare, Plus, History, Sparkles, Trash2, User, X } from "lucide-react";
import { AI_DOCK_WIDTH, useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { confirmAction } from "@/components/ui/confirm";
import { QUICK_ACTIONS } from "@/lib/ai/quickActions";
import { SQL_DIALECTS, SqlDialect } from "@/lib/sql/dialects";
import { modelToDbml } from "@/lib/dbml/serializer";
import { parseDbml } from "@/lib/dbml/parser";
import { DiffOp, diffLines, diffModels, diffStats, groupsTouchedKeys, schemaDiffToLines, schemaDiffTouchedKeys } from "@/lib/model/diff";
import { DiagramModel } from "@/lib/model/types";
import { apiErrorMessage } from "@/lib/apiError";

/** Which tables a proposal touches, tagged "added"/"modified" — passed to `CanvasApi.highlightTables` on accept. */
type Touched = Record<string, "added" | "modified">;

interface Msg {
  role: "user" | "assistant";
  content: string;
  /** proposed DBML waiting for the user's decision */
  proposal?: { dbml: string; before?: string; status: "pending" | "applied" | "discarded"; changes?: string[]; touched?: Touched };
}
interface Thread {
  id: string;
  title: string;
  messages: Msg[];
  updatedAt: number;
  createdAt?: number;
}

/** The welcome screen's suggestions. Four run instantly and offline (with a diff to review); the last one asks the assistant. */
const SUGGESTIONS: { id: string; title: string; description: string; icon: React.ReactNode; tone: string; action?: string; prompt?: string }[] = [
  { id: "groups", action: "groups", title: "Create Table Groups", description: "Organize your tables into logical groups by domain and functionality with distinct colors", icon: <Layers size={16} />, tone: "bg-[#4A90D9]/15 text-[#7ec8ff]" },
  { id: "timestamps", action: "timestamps", title: "Add Timestamp Columns", description: "Add created_at and updated_at columns to every table that doesn't have them yet", icon: <Clock size={16} />, tone: "bg-violet-500/15 text-violet-300" },
  { id: "relationships", action: "relationships", title: "Add Relationships", description: "Automatically detect and add foreign key relationships based on naming conventions", icon: <Link2 size={16} />, tone: "bg-emerald-500/15 text-emerald-300" },
  { id: "indexes", action: "indexes", title: "Add Indexes", description: "Add index blocks for foreign key columns that aren't indexed yet", icon: <ListTree size={16} />, tone: "bg-amber-500/15 text-amber-300" },
  {
    id: "learn",
    prompt: "Teach me the essentials of good database design — normalization, keys, relationships and indexing — using my current diagram as the example.",
    title: "Learn Database Design",
    description: "Learn about database design",
    icon: <BookOpen size={16} />,
    tone: "bg-pink-500/15 text-pink-300",
  },
];
const MAIN_ACTIONS = new Set(SUGGESTIONS.map((s) => s.action).filter(Boolean));

const stamp = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const createdOf = (t: Thread) => t.createdAt ?? (Number(t.id.replace(/\D/g, "")) || t.updatedAt);
const freshThread = (): Thread => {
  const now = Date.now();
  return { id: `t_${now}`, title: "New chat", messages: [], updatedAt: now, createdAt: now };
};

/** **bold**, *italic*, `code`, lists, "#" headings, rules and simple tables — enough for the assistant's answers. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g).map((p, i) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-semibold text-white">{p.slice(2, -2)}</strong>;
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return <code key={i} className="px-1 py-px rounded bg-white/10 text-[#9cdcfe] font-mono text-[11px]">{p.slice(1, -1)}</code>;
    return p;
  });
}
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const tableCells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
function RichText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[] = [];
  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={`pl-5 space-y-0.5 ${list.ordered ? "list-decimal" : "list-disc"}`}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>
    );
    list = null;
  };
  const flushTable = () => {
    if (!table.length) return;
    const [head, ...rest] = table;
    const body = rest.filter((r) => !/^[\s|:-]+$/.test(r)); // drop the |---|---| separator
    blocks.push(
      <div key={blocks.length} className="overflow-x-auto code-scroll rounded-lg border border-white/[0.08]">
        <table className="w-full text-[11px] border-collapse">
          <thead>
            <tr>
              {tableCells(head).map((c, i) => (
                <th key={i} className="text-left font-semibold text-white px-2 py-1 bg-white/[0.05] whitespace-nowrap">
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, i) => (
              <tr key={i} className="border-t border-white/[0.06]">
                {tableCells(r).map((c, j) => (
                  <td key={j} className="px-2 py-1 align-top">
                    {inline(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    table = [];
  };
  for (const line of text.split("\n")) {
    if (isTableRow(line)) {
      flushList();
      table.push(line);
      continue;
    }
    flushTable();
    const li = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = !!li[2];
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(li[3]);
      continue;
    }
    flushList();
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) blocks.push(<p key={blocks.length} className="font-semibold text-white pt-1">{inline(h[1])}</p>);
    else if (/^\s*([-*_])\1{2,}\s*$/.test(line)) blocks.push(<hr key={blocks.length} className="border-white/10" />);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flushList();
  flushTable();
  return <div className="space-y-1.5">{blocks}</div>;
}

function DiffView({ before, after }: { before: string; after: string }) {
  const ops = useMemo(() => diffLines(before, after), [before, after]);
  const stats = diffStats(ops);
  // collapse long unchanged runs
  const rows: (DiffOp | { gap: number })[] = [];
  let run: DiffOp[] = [];
  const flush = (last: boolean) => {
    if (run.length > 6 && !last) {
      rows.push(...run.slice(0, 2), { gap: run.length - 4 }, ...run.slice(-2));
    } else if (run.length > 3 && last) {
      rows.push(...run.slice(0, 3), { gap: run.length - 3 });
    } else rows.push(...run);
    run = [];
  };
  ops.forEach((o) => {
    if (o.type === "same") run.push(o);
    else {
      flush(false);
      rows.push(o);
    }
  });
  flush(true);
  return (
    <div className="rounded-lg border border-white/[0.08] bg-[#111316] overflow-hidden">
      <div className="flex justify-between px-3 py-1.5 border-b border-white/[0.06] text-[10px] font-mono bg-white/[0.02]">
        <span className="text-white/45">DBML changes</span>
        <span>
          <span className="text-emerald-400">+{stats.added}</span> <span className="text-red-400 ml-2">−{stats.removed}</span>
        </span>
      </div>
      <div className="max-h-56 overflow-auto code-scroll font-mono text-[10.5px] leading-[1.55]">
        {rows.map((r, i) =>
          "gap" in r ? (
            <div key={i} className="px-3 text-white/25 bg-white/[0.02]">
              ⋯ {r.gap} unchanged lines
            </div>
          ) : (
            <div key={i} className={`px-3 whitespace-pre ${r.type === "add" ? "bg-emerald-500/12 text-emerald-200" : r.type === "del" ? "bg-red-500/12 text-red-200 line-through decoration-red-400/40" : "text-white/40"}`}>
              <span className="select-none inline-block w-3 text-white/30">{r.type === "add" ? "+" : r.type === "del" ? "−" : " "}</span>
              {r.text || " "}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function HeaderBtn({ title, onClick, active, children }: { title: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className={`p-1.5 rounded-md transition-colors ${active ? "bg-white/[0.1] text-white" : "text-white/55 hover:text-white hover:bg-white/[0.08]"}`}>
      {children}
    </button>
  );
}

/**
 * The AI chat: docked on the left of the code editor (like dbdiagram.io's). Welcome screen with one-click suggestions,
 * a chat stream, a history of earlier chats, and the message box at the bottom. Every schema change is shown as a diff
 * and only applied when you accept it.
 */
export function AiPanel({ onClose }: { onClose: () => void }) {
  const layout = useLayout();
  const api = layout.getCanvasApi();
  const key = `designdb_ai:${layout.meta.versionKey}`;
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [dialect, setDialect] = useState<SqlDialect>((SQL_DIALECTS.find((d) => d.id === api?.getSqlDialect())?.id || "postgres") as SqlDialect);
  const [actionResult, setActionResult] = useState<{ label: string; changes: string[]; before: string; after: string; model: DiagramModel; touched: Touched } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  // `layout.aiProposal.resolve` is a closure the code editor can call long after it was created (many renders
  // later, from a stale snapshot of every value below); it must always see what's *current*, not what it was
  // at creation time.
  const threadsRef = useRef<Thread[]>(threads);
  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);
  const actionResultRef = useRef(actionResult);
  useEffect(() => {
    actionResultRef.current = actionResult;
  }, [actionResult]);
  const aiProposalIdRef = useRef<string | null>(null);
  useEffect(() => {
    aiProposalIdRef.current = layout.aiProposal?.id ?? null;
  }, [layout.aiProposal]);

  // persist threads per diagram
  useEffect(() => {
    // a diff waiting for review belongs to the diagram it was computed from — never carry it over to another tab
    setActionResult(null);
    setShowHistory(false);
    layout.setAiProposal(null);
    try {
      const raw = localStorage.getItem(key);
      const list: Thread[] = raw ? JSON.parse(raw) : [];
      if (list.length) {
        setThreads(list);
        setActiveId(list[0].id);
        return;
      }
    } catch {
      /* fall through to a fresh chat */
    }
    const t = freshThread();
    setThreads([t]);
    setActiveId(t.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!threads.length) return;
    try {
      localStorage.setItem(key, JSON.stringify(threads.slice(0, 20)));
    } catch {
      /* quota */
    }
  }, [threads, key]);

  const thread = threads.find((t) => t.id === activeId);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread?.messages.length, busy, actionResult]);

  // "Generate with AI" in the New schema dialog hands its prompt over through sessionStorage — send it as soon as a chat is
  // ready (also when the panel is already open and the new diagram just switched the chat)
  useEffect(() => {
    if (!thread) return;
    let prompt: string | null = null;
    try {
      prompt = sessionStorage.getItem("designdb_ai_prompt");
      if (prompt) sessionStorage.removeItem("designdb_ai_prompt");
    } catch {
      /* storage unavailable */
    }
    if (prompt) void send(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id]);

  // the message box grows with what you type, up to a limit
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeId]);

  // the history list closes when you click anywhere else
  useEffect(() => {
    if (!showHistory) return;
    const onDown = (e: MouseEvent) => {
      if (!historyRef.current?.contains(e.target as Node)) setShowHistory(false);
    };
    document.addEventListener("pointerdown", onDown, true); // capture: the canvas stops mousedown from bubbling
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showHistory]);

  const update = (id: string, fn: (t: Thread) => Thread) => setThreads((ts) => ts.map((t) => (t.id === id ? { ...fn(t), updatedAt: Date.now() } : t)));
  /** appends messages; the first user message names the chat */
  const append = (id: string, ...msgs: Msg[]) =>
    update(id, (t) => ({ ...t, title: t.messages.length === 0 && msgs[0]?.role === "user" ? msgs[0].content.slice(0, 40) : t.title, messages: [...t.messages, ...msgs] }));

  const newThread = () => {
    setActionResult(null);
    setShowHistory(false);
    layout.setAiProposal(null);
    if (thread && thread.messages.length === 0) {
      inputRef.current?.focus();
      return; // already on an empty chat
    }
    const t = freshThread();
    setThreads((ts) => [t, ...ts]);
    setActiveId(t.id);
  };
  const openThread = (id: string) => {
    setActiveId(id);
    setActionResult(null);
    setShowHistory(false);
    layout.setAiProposal(null);
  };
  const deleteThread = async (id: string, anchor: Element) => {
    const t = threads.find((x) => x.id === id);
    const ok = await confirmAction({
      message: ["You're deleting chat ", { strong: t?.title || "Untitled chat" }, ". Are you sure?"],
      detail: t ? `${t.messages.length} message${t.messages.length === 1 ? "" : "s"}` : undefined,
      note: "A deleted chat can't be restored.",
      anchor,
    });
    if (!ok) return;
    setThreads((ts) => {
      const rest = ts.filter((t) => t.id !== id);
      if (!rest.length) {
        const t = freshThread();
        setActiveId(t.id);
        return [t];
      }
      if (id === activeId) setActiveId(rest[0].id);
      return rest;
    });
  };

  const currentDbml = () => (api ? modelToDbml(api.getModel()) : "");

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || !thread || busy || !api) return;
    setInput("");
    const tid = thread.id;
    const beforeModel = api.getModel();
    const history: Msg[] = [...thread.messages, { role: "user", content: prompt }];
    const msgIdx = history.length; // where the assistant's reply will land
    update(tid, (t) => ({ ...t, title: t.messages.length === 0 ? prompt.slice(0, 40) : t.title, messages: history }));
    setBusy(true);
    try {
      const res = await fetch("/api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })), dbml: modelToDbml(beforeModel), dialect: SQL_DIALECTS.find((d) => d.id === dialect)?.label }) });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data, "The assistant is unavailable"));
      let proposal: Msg["proposal"];
      let replyText = data.reply || "Done.";
      if (data.dbml) {
        const parsed = parseDbml(data.dbml);
        if (parsed.ok) {
          const diff = diffModels(beforeModel, parsed.model);
          const touched = { ...schemaDiffTouchedKeys(diff), ...groupsTouchedKeys(beforeModel, parsed.model) };
          proposal = { dbml: data.dbml as string, before: modelToDbml(beforeModel), status: "pending", changes: schemaDiffToLines(diff), touched };
        } else {
          // The server validates its own output before replying, but never show an Accept button on
          // something already known to fail — that's how a raw parser error reaches the user.
          replyText = `${replyText}\n\n⚠ The suggested schema had a formatting problem and can't be applied — try rephrasing the request, or asking for a smaller change.`;
        }
      }
      append(tid, { role: "assistant", content: replyText, proposal });
      if (proposal) {
        layout.setAiProposal({
          id: `${tid}:${msgIdx}`,
          label: prompt,
          before: modelToDbml(beforeModel),
          after: proposal.dbml,
          changes: proposal.changes || [],
          resolve: (accept) => decide(msgIdx, accept, tid),
        });
      }
    } catch (e: any) {
      append(tid, { role: "assistant", content: `⚠ ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  const decide = (msgIdx: number, accept: boolean, threadId?: string) => {
    const tid = threadId || thread?.id;
    const t = threadsRef.current.find((x) => x.id === tid);
    const m = t?.messages[msgIdx];
    if (!t || !m?.proposal || !api) return;
    if (accept) {
      const { model, ok, diagnostics } = parseDbml(m.proposal.dbml);
      if (!ok) {
        showToast(`The suggested DBML has errors: ${diagnostics.find((d) => d.severity === "error")?.message}`, "error");
        return;
      }
      api.applyModel(model, { mode: "replace", layout: "keep", restorePoint: "Before AI change" });
      if (m.proposal.touched) api.highlightTables(m.proposal.touched);
      showToast("AI changes applied — undo any time from Version history", "success");
    }
    update(tid!, (th) => ({ ...th, messages: th.messages.map((x, i) => (i === msgIdx && x.proposal ? { ...x, proposal: { ...x.proposal, status: accept ? "applied" : "discarded" } } : x)) }));
    if (aiProposalIdRef.current === `${tid}:${msgIdx}`) layout.setAiProposal(null);
  };

  /** A deterministic quick action: shown in the chat like any request, with the diff to review under it. */
  const runAction = (id: string, title?: string) => {
    if (!api || !thread || busy) return;
    const action = QUICK_ACTIONS.find((a) => a.id === id)!;
    const name = title || action.label;
    const asked: Msg = { role: "user", content: name };
    const before = api.getModel();
    const r = action.run(before, { dialect });
    if (!r.changes.length) {
      append(thread.id, asked, { role: "assistant", content: `Nothing to change for “${name}” — your diagram already covers this.` });
      return;
    }
    const n = r.changes.length;
    append(thread.id, asked, { role: "assistant", content: `Found ${n} change${n === 1 ? "" : "s"} for “${name}”. Review the diff, then apply it.` });
    const touched = { ...schemaDiffTouchedKeys(diffModels(before, r.model)), ...groupsTouchedKeys(before, r.model) };
    setActionResult({ label: name, changes: r.changes, before: modelToDbml(before), after: modelToDbml(r.model), model: r.model, touched });
    const tid = thread.id;
    layout.setAiProposal({ id: "action", label: name, before: modelToDbml(before), after: modelToDbml(r.model), changes: r.changes, resolve: (accept) => (accept ? acceptAction(tid) : discardAction(tid)) });
  };

  const acceptAction = (threadId?: string) => {
    const ar = actionResultRef.current;
    const tid = threadId || thread?.id;
    if (!ar || !api || !tid) return;
    api.applyModel(ar.model, { mode: "replace", layout: "keep", restorePoint: `Before “${ar.label}”` });
    api.highlightTables(ar.touched);
    showToast(`${ar.label}: ${ar.changes.length} change(s) applied`, "success");
    append(tid, { role: "assistant", content: `✓ Applied ${ar.changes.length} change(s). You can undo them from Version history.` });
    setActionResult(null);
    if (aiProposalIdRef.current === "action") layout.setAiProposal(null);
  };
  const discardAction = (threadId?: string) => {
    const tid = threadId || thread?.id;
    if (tid) append(tid, { role: "assistant", content: "Discarded — nothing was changed." });
    setActionResult(null);
    if (aiProposalIdRef.current === "action") layout.setAiProposal(null);
  };

  const pick = (s: (typeof SUGGESTIONS)[number]) => (s.action ? runAction(s.action, s.title) : void send(s.prompt || s.title));
  const extraActions = QUICK_ACTIONS.filter((a) => !MAIN_ACTIONS.has(a.id));
  const empty = !!thread && thread.messages.length === 0 && !actionResult;
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <aside className="relative h-full shrink-0 flex flex-col bg-[#181a1f] border-r border-white/[0.08] text-white animate-in slide-in-from-left-4 duration-200" style={{ width: AI_DOCK_WIDTH }} aria-label="AI assistant">
      {/* header: chat name + new chat / history / close */}
      <div className="relative h-12 shrink-0 flex items-center justify-between gap-2 pl-4 pr-2.5 border-b border-white/[0.08]" ref={historyRef}>
        <div className="flex items-center gap-2 min-w-0 text-[13px] font-semibold text-white/90">
          <MessageSquare size={16} className="text-white/60 shrink-0" />
          <span className="truncate">Chat {thread ? stamp(createdOf(thread)) : ""}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <HeaderBtn title="New chat" onClick={newThread}>
            <Plus size={17} />
          </HeaderBtn>
          <HeaderBtn title="Chat history" onClick={() => setShowHistory((v) => !v)} active={showHistory}>
            <History size={16} />
          </HeaderBtn>
          <HeaderBtn title="Close AI assistant" onClick={onClose}>
            <X size={16} />
          </HeaderBtn>
        </div>

        {showHistory && (
          <div className="absolute top-[calc(100%+6px)] left-3 right-3 z-30 max-h-80 overflow-y-auto code-scroll rounded-xl border border-white/[0.1] bg-[#22252b] shadow-[0_16px_40px_rgba(0,0,0,0.6)] p-1.5">
            <p className="px-2.5 pt-1 pb-1.5 text-[10px] uppercase tracking-wider font-semibold text-white/35">Chat history</p>
            {sorted.map((t) => (
              <div key={t.id} className={`group flex items-center gap-1 rounded-lg ${t.id === activeId ? "bg-[#4A90D9]/15" : "hover:bg-white/[0.06]"}`}>
                <button onClick={() => openThread(t.id)} className="flex-1 min-w-0 text-left px-2.5 py-2">
                  <span className="block text-[12.5px] font-medium text-white/90 truncate">{t.title}</span>
                  <span className="block text-[10.5px] text-white/35">{stamp(createdOf(t))} · {t.messages.length} message{t.messages.length === 1 ? "" : "s"}</span>
                </button>
                <button onClick={(e) => void deleteThread(t.id, e.currentTarget)} title="Delete chat" aria-label="Delete chat" className="p-1.5 mr-1 rounded-md text-white/0 group-hover:text-white/40 hover:!text-red-300 hover:bg-white/[0.06] transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto code-scroll px-3 py-4">
        {empty ? (
          <div>
            <div className="text-center pt-1 pb-4">
              <div className="flex items-center justify-center gap-2">
                <h2 className="text-[17px] font-bold tracking-tight whitespace-nowrap">Welcome to DesignDB AI</h2>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider bg-[#4A90D9]/20 text-[#7ec8ff] border border-[#4A90D9]/30">BETA</span>
              </div>
              <p className="mt-1.5 text-[12.5px] text-white/50">Your intelligent assistant for database design</p>
            </div>

            <div className="space-y-1">
              {SUGGESTIONS.map((s) => (
                <button key={s.id} onClick={() => pick(s)} disabled={busy} className="w-full flex items-start gap-2.5 text-left px-2.5 py-2.5 rounded-xl hover:bg-white/[0.06] transition-colors disabled:opacity-50">
                  <span className={`mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${s.tone}`}>{s.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-white">{s.title}</span>
                    <span className="mt-0.5 text-[11.5px] leading-snug text-white/45 line-clamp-3">{s.description}</span>
                  </span>
                </button>
              ))}
            </div>

            <button onClick={() => setShowMore((v) => !v)} className="mx-auto mt-3 flex items-center gap-1 text-[11.5px] text-white/40 hover:text-white/75 transition-colors">
              <ChevronDown size={13} className={`transition-transform ${showMore ? "rotate-180" : ""}`} /> More quick actions
            </button>
            {showMore && (
              <div className="mt-2 space-y-1">
                {extraActions.map((a) => (
                  <button key={a.id} onClick={() => runAction(a.id)} disabled={busy} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.06] transition-colors disabled:opacity-50">
                    <span className="block text-[12.5px] font-semibold text-white/90">{a.label}</span>
                    <span className="block text-[11px] text-white/40">{a.description}</span>
                  </button>
                ))}
                <label className="flex items-center justify-between gap-2 px-3 pt-1 text-[11px] text-white/40">
                  Target database for type remapping
                  <select className="bg-[#23262d] border border-white/[0.1] rounded-md px-1.5 py-1 text-[11px] text-white/80 outline-none cursor-pointer" value={dialect} onChange={(e) => setDialect(e.target.value as SqlDialect)}>
                    {SQL_DIALECTS.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <p className="mt-4 text-center text-[10.5px] text-white/30">Your schema is only sent to the AI service when you send a message.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {thread?.messages.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${m.role === "user" ? "bg-[#4A90D9]/25 text-[#7ec8ff]" : "bg-violet-500/20 text-violet-300"}`}>{m.role === "user" ? <User size={12} /> : <Bot size={12} />}</div>
                <div className={`min-w-0 max-w-[88%] space-y-2 ${m.role === "user" ? "flex flex-col items-end" : ""}`}>
                  <div className={`text-[12.5px] leading-relaxed rounded-xl px-3 py-2 ${m.role === "user" ? "bg-[#4A90D9]/20 text-white whitespace-pre-wrap" : "bg-white/[0.05] text-white/85"}`}>{m.role === "user" ? m.content : <RichText text={m.content} />}</div>
                  {m.proposal && (
                    <div className="space-y-2 w-full">
                      {m.proposal.status === "pending" ? (
                        <>
                          {!!m.proposal.changes?.length && (
                            <div className="rounded-lg border border-[#4A90D9]/25 bg-[#4A90D9]/[0.06] p-2.5">
                              <span className="text-[9px] uppercase tracking-wider font-bold text-[#7ec8ff]/80 block mb-1">Schema changes</span>
                              <ul className="text-[11px] text-white/65 space-y-0.5 max-h-24 overflow-y-auto code-scroll list-disc pl-4">
                                {m.proposal.changes.slice(0, 40).map((c, ci) => (
                                  <li key={ci}>{c}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <DiffView before={m.proposal.before ?? currentDbml()} after={m.proposal.dbml} />
                          <div className="flex gap-2">
                            <button className={btnPrimary} onClick={() => decide(i, true)}>
                              <Check size={13} /> Accept
                            </button>
                            <button className={btnGhost} onClick={() => decide(i, false)}>
                              <X size={13} /> Reject
                            </button>
                          </div>
                        </>
                      ) : (
                        <span className={`text-[10.5px] font-semibold ${m.proposal.status === "applied" ? "text-emerald-300" : "text-white/35"}`}>{m.proposal.status === "applied" ? "✓ Applied" : "Discarded"}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {actionResult && (
              <div className="rounded-xl border border-[#4A90D9]/30 bg-[#4A90D9]/[0.06] p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[12px] font-bold">
                    <Sparkles size={12} className="text-[#7ec8ff]" /> {actionResult.label}
                  </span>
                  <span className="text-[10px] text-white/40">{actionResult.changes.length} change(s)</span>
                </div>
                <ul className="text-[11px] text-white/65 space-y-0.5 max-h-24 overflow-y-auto code-scroll list-disc pl-4">
                  {actionResult.changes.slice(0, 40).map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
                <DiffView before={actionResult.before} after={actionResult.after} />
                <div className="flex gap-2">
                  <button className={btnPrimary} onClick={() => acceptAction()}>
                    <Check size={13} /> Apply
                  </button>
                  <button className={btnGhost} onClick={() => discardAction()}>
                    <X size={13} /> Discard
                  </button>
                </div>
              </div>
            )}

            {busy && (
              <div className="flex items-center gap-2 text-[11.5px] text-white/45">
                <Loader2 size={13} className="animate-spin" /> Thinking…
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* message box */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="rounded-xl border border-white/[0.12] bg-[#23262d] focus-within:border-[#4A90D9]/60 transition-colors">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="Ask me anything about your diagram…"
            className="w-full resize-none bg-transparent px-3 pt-3 pb-1 text-[12.5px] leading-snug text-white placeholder:text-white/30 outline-none code-scroll"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="text-[10.5px] text-white/35">Press Enter to send, Shift+Enter for new line</span>
            <button
              onClick={() => send(input)}
              disabled={busy || !input.trim()}
              title="Send"
              aria-label="Send message"
              className="w-8 h-8 shrink-0 rounded-lg bg-[#4A90D9] text-white flex items-center justify-center hover:bg-[#5a9fe6] transition-colors disabled:bg-white/[0.08] disabled:text-white/30 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={16} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

const btnPrimary = "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4A90D9] text-white text-[12px] font-semibold hover:bg-[#5a9fe6] transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost = "flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/[0.1] text-white/70 hover:text-white hover:bg-white/[0.1] text-[12px] font-medium transition-colors";
