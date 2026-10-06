"use client";

import React, { useMemo, useState } from "react";
import { List, Plus, Trash2 } from "lucide-react";
import { ModalShell, btnGhost, btnPrimary, inputCls, labelCls } from "./ModalShell";
import { useLayout } from "@/components/Layout/LayoutContext";
import { showToast } from "@/components/ui/toast";
import { confirmAction } from "@/components/ui/confirm";
import { EnumModel } from "@/lib/model/types";

/** Enum manager: define enum types, then use their names as column types (DBML `Enum`). */
export function EnumsModal({ onClose }: { onClose: () => void }) {
  const layout = useLayout();
  const enums = layout.meta.enums;
  const [sel, setSel] = useState(0);
  const cur = enums[sel];

  const usage = useMemo(() => {
    const api = layout.getCanvasApi();
    const out = new Map<string, string[]>();
    if (!api) return out;
    for (const n of api.getState().nodes) {
      if (n.type !== "tableMode") continue;
      for (const a of ((n.data as any).attributes as any[]) || []) {
        const e = enums.find((x) => x.name === a.type);
        if (e) out.set(e.name, [...(out.get(e.name) || []), `${(n.data as any).label}.${a.name}`]);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enums]);

  const save = (next: EnumModel[]) => layout.setMeta((m) => ({ ...m, enums: next }));
  const patch = (p: Partial<EnumModel>) => save(enums.map((e, i) => (i === sel ? { ...e, ...p } : e)));

  const add = () => {
    let n = 1;
    while (enums.some((e) => e.name === `enum_${n}`)) n++;
    save([...enums, { name: `enum_${n}`, values: [{ name: "value_1" }, { name: "value_2" }] }]);
    setSel(enums.length);
  };

  const rename = (name: string) => {
    if (!cur) return;
    const clean = name.replace(/\s+/g, "_");
    const old = cur.name;
    // keep columns pointing at the renamed enum
    const api = layout.getCanvasApi();
    if (api && old !== clean) {
      const { nodes, edges, meta } = api.getState();
      const nn = nodes.map((n) => (n.type === "tableMode" && ((n.data as any).attributes || []).some((a: any) => a.type === old) ? { ...n, data: { ...n.data, attributes: (n.data as any).attributes.map((a: any) => (a.type === old ? { ...a, type: clean } : a)) } } : n));
      api.setGraph({ nodes: nn, edges, meta: { ...meta, enums: meta.enums.map((e, i) => (i === sel ? { ...e, name: clean } : e)) } });
    } else patch({ name: clean });
  };

  const remove = async (e: React.MouseEvent<HTMLElement>) => {
    if (!cur) return;
    const used = usage.get(cur.name)?.length || 0;
    const ok = await confirmAction({
      message: ["You're deleting enum ", { strong: cur.name }, ". Are you sure?"],
      detail: used ? `It is the type of ${used} column${used === 1 ? "" : "s"} — ${used === 1 ? "it keeps" : "they keep"} “${cur.name}” as a plain type name.` : `${cur.values.length} value${cur.values.length === 1 ? "" : "s"}, not used by any column.`,
      anchor: e.currentTarget,
    });
    if (!ok) return;
    save(enums.filter((_, i) => i !== sel));
    setSel(0);
    showToast(`Enum “${cur.name}” deleted`, "success");
  };

  return (
    <ModalShell title="Enums" subtitle="Reusable value lists — use the enum name as a column type" icon={<List size={16} />} onClose={onClose} width="max-w-3xl" height="h-[70vh]">
      <div className="flex-1 min-h-0 grid md:grid-cols-[210px_1fr]">
        <div className="border-r border-white/[0.06] overflow-y-auto p-3 space-y-1">
          <button className={`${btnPrimary} w-full`} onClick={add}>
            <Plus size={13} /> New enum
          </button>
          {enums.map((e, i) => (
            <button key={e.name + i} onClick={() => setSel(i)} className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${i === sel ? "bg-[#4A90D9]/15 border-[#4A90D9]/35" : "border-transparent hover:bg-white/[0.05]"}`}>
              <span className="block text-[12px] font-semibold truncate">{e.name}</span>
              <span className="block text-[10px] text-white/40">
                {e.values.length} values · used by {usage.get(e.name)?.length || 0}
              </span>
            </button>
          ))}
          {enums.length === 0 && <p className="text-[11px] text-white/35 text-center pt-6">No enums yet.</p>}
        </div>
        <div className="overflow-y-auto p-5 space-y-4">
          {cur ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={labelCls}>Name</span>
                  <input className={inputCls} value={cur.name} onChange={(e) => rename(e.target.value)} />
                </div>
                <div>
                  <span className={labelCls}>Schema (optional)</span>
                  <input className={inputCls} value={cur.schema || ""} onChange={(e) => patch({ schema: e.target.value || undefined })} />
                </div>
              </div>
              <div>
                <span className={labelCls}>Values</span>
                <div className="space-y-1.5">
                  {cur.values.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <input className={`${inputCls} font-mono`} value={v.name} onChange={(e) => patch({ values: cur.values.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                      <input className={inputCls} placeholder="note (optional)" value={v.note || ""} onChange={(e) => patch({ values: cur.values.map((x, j) => (j === i ? { ...x, note: e.target.value || undefined } : x)) })} />
                      <button className={`${btnGhost} hover:!text-red-300`} onClick={() => patch({ values: cur.values.filter((_, j) => j !== i) })}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className={`${btnGhost} mt-2`} onClick={() => patch({ values: [...cur.values, { name: `value_${cur.values.length + 1}` }] })}>
                  <Plus size={13} /> Add value
                </button>
              </div>
              {(usage.get(cur.name)?.length || 0) > 0 && (
                <div>
                  <span className={labelCls}>Used by</span>
                  <div className="flex flex-wrap gap-1.5">
                    {usage.get(cur.name)!.map((u) => (
                      <span key={u} className="text-[10.5px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-white/65">
                        {u}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <button className={`${btnGhost} hover:!text-red-300`} onClick={(e) => void remove(e)}>
                <Trash2 size={13} /> Delete enum
              </button>
            </>
          ) : (
            <p className="text-center text-white/35 text-sm pt-16">Create an enum, then type its name in any column&apos;s type field.</p>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
