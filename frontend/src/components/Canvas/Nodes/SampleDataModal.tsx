"use client";

import React from "react";
import { X, Pencil, Download, Table2 } from "lucide-react";
import { Node } from "@xyflow/react";

interface SampleDataModalProps {
  isOpen: boolean;
  tableNodeId: string | null;
  nodes: Node[];
  onClose: () => void;
  onOpenEditModal: (id: string) => void;
}

export function SampleDataModal({
  isOpen,
  tableNodeId,
  nodes,
  onClose,
  onOpenEditModal,
}: SampleDataModalProps) {
  if (!isOpen || !tableNodeId) return null;

  const node = nodes.find((n) => n.id === tableNodeId);
  if (!node) return null;

  const data = node.data as any;
  const tableName = data.label || "table";
  const schemaGroup = data.group ? `${data.group}.${tableName}` : `public.${tableName}`;
  const attributes = (data.attributes as any[]) || [];
  
  // Seed data or generated mock rows
  let rows: any[] = (data.seedData as any[]) || [];

  // Generate 4 realistic mock sample rows if none defined
  if (rows.length === 0 && attributes.length > 0) {
    rows = [1, 2, 3, 4].map((idNum) => {
      const rowObj: any = {};
      attributes.forEach((attr) => {
        const type = (attr.type || "").toLowerCase();
        const name = (attr.name || "").toLowerCase();
        
        if (name === "id" || attr.isPk) {
          rowObj[attr.name] = idNum - 1;
        } else if (name.includes("user") || name.includes("name")) {
          const names = ["Alice", "Bob", "Candice", "David"];
          rowObj[attr.name] = names[idNum - 1];
        } else if (name.includes("email")) {
          const emails = ["alice@example.com", "bob@example.com", "candice@example.com", "david@example.com"];
          rowObj[attr.name] = emails[idNum - 1];
        } else if (name.includes("role")) {
          const roles = ["admin", "moderator", "moderator", "member"];
          rowObj[attr.name] = roles[idNum - 1];
        } else if (name.includes("status")) {
          rowObj[attr.name] = idNum % 2 === 0 ? "active" : "pending";
        } else if (type.includes("int") || type.includes("serial") || type.includes("numeric") || type.includes("bigint")) {
          rowObj[attr.name] = idNum * 10;
        } else if (type.includes("bool")) {
          rowObj[attr.name] = idNum % 2 === 1;
        } else if (type.includes("time") || type.includes("date")) {
          rowObj[attr.name] = "(null)";
        } else {
          rowObj[attr.name] = `val_${idNum}`;
        }
      });
      return rowObj;
    });
  }

  // Handle CSV Download
  const handleDownloadCSV = () => {
    if (attributes.length === 0 || rows.length === 0) return;

    const headers = attributes.map((a) => a.name).join(",");
    const rowLines = rows.map((r) =>
      attributes.map((a) => {
        const val = r[a.name];
        if (val === null || val === undefined) return "";
        const str = String(val).replace(/"/g, '""');
        return str.includes(",") ? `"${str}"` : str;
      }).join(",")
    );

    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rowLines].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${tableName}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEdit = () => {
    onClose();
    onOpenEditModal(tableNodeId);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 select-none">
      <div className="w-full max-w-4xl bg-white dark:bg-[#0c101b] rounded-2xl border border-slate-200 dark:border-white/[0.1] shadow-2xl flex flex-col overflow-hidden text-slate-800 dark:text-white animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-[#080c14]">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 font-bold text-sm text-slate-800 dark:text-white">
              <Table2 size={16} className="text-[#4A90D9]" />
              <span>{schemaGroup}</span>
            </div>

            {/* Edit Button */}
            <button
              onClick={handleEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] hover:bg-slate-100 dark:hover:bg-white/[0.08] text-xs font-semibold text-slate-700 dark:text-white transition-all shadow-sm"
            >
              <Pencil size={13} />
              Edit
            </button>

            {/* Download CSV Button */}
            <button
              onClick={handleDownloadCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.04] hover:bg-slate-100 dark:hover:bg-white/[0.08] text-xs font-semibold text-slate-700 dark:text-white transition-all shadow-sm"
            >
              <Download size={13} />
              Download
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-white/[0.06] transition-all"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body - Data Grid */}
        <div className="p-6 overflow-x-auto">
          {attributes.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400 italic">No attributes defined for this table.</div>
          ) : (
            <div className="border border-slate-200 dark:border-white/[0.08] rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-white/[0.03] border-b border-slate-200 dark:border-white/[0.08]">
                    <th className="py-2.5 px-3 w-10 text-center text-slate-400 font-mono text-[11px]">#</th>
                    {attributes.map((attr) => (
                      <th key={attr.name} className="py-2.5 px-4 font-bold text-slate-700 dark:text-white/80 border-r border-slate-200/50 dark:border-white/[0.04] last:border-r-0">
                        <div className="flex flex-col">
                          <span>{attr.name}</span>
                          <span className="text-[9px] font-normal text-slate-400 dark:text-white/40 font-mono">{attr.type}</span>
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {rows.map((row, rowIdx) => (
                    <tr key={rowIdx} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                      <td className="py-2 px-3 text-center text-slate-400 font-mono text-[10px]">{rowIdx + 1}</td>
                      {attributes.map((attr) => {
                        const val = row[attr.name];
                        const isNull = val === "(null)" || val === null || val === undefined;
                        return (
                          <td key={attr.name} className="py-2 px-4 font-mono text-slate-600 dark:text-white/70 border-r border-slate-100 dark:border-white/[0.02] last:border-r-0">
                            {isNull ? (
                              <span className="text-slate-400 dark:text-white/30 italic">(null)</span>
                            ) : (
                              String(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
