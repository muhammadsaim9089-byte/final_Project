"use client";

import React, { useState, useEffect } from "react";
import { FolderOpen, Plus, Trash2, Copy, FileText, Calendar, Loader2, X, Check, Edit2 } from "lucide-react";
import { Node, Edge } from "@xyflow/react";

interface Project {
  id: string;
  title: string;
  rawPrompt: string;
  nodesJson: any[];
  edgesJson: any[];
  createdAt: string;
  updatedAt: string;
}

interface DashboardProps {
  isOpen: boolean;
  onClose: () => void;
  currentProjectId: string | null;
  setCurrentProjectId: (id: string | null) => void;
  projectTitle: string;
  setProjectTitle: (title: string) => void;
  nodes: Node[];
  edges: Edge[];
  onLoadProject: (project: Project) => void;
  onCreateNewProject: () => void;
}

export function Dashboard({
  isOpen,
  onClose,
  currentProjectId,
  setCurrentProjectId,
  projectTitle,
  setProjectTitle,
  nodes,
  edges,
  onLoadProject,
  onCreateNewProject,
}: DashboardProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [newTitleVal, setNewTitleVal] = useState("");

  const fetchProjects = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err: any) {
      setError(err.message || "Something went wrong fetching projects.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchProjects();
    }
  }, [isOpen]);

  const handleSaveCurrent = async (customTitle?: string) => {
    const finalTitle = customTitle || projectTitle || "Untitled Schema";
    setSaving(true);
    try {
      const res = await fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: currentProjectId || undefined,
          title: finalTitle,
          nodes,
          edges,
        }),
      });
      if (!res.ok) throw new Error("Failed to save project");
      const data = await res.json();
      
      setCurrentProjectId(data.project.id);
      setProjectTitle(data.project.title);
      await fetchProjects();
    } catch (err: any) {
      setError(err.message || "Failed to save project.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this project?")) return;
    
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete project");
      if (currentProjectId === id) {
        setCurrentProjectId(null);
        setProjectTitle("Untitled Schema");
      }
      await fetchProjects();
    } catch (err: any) {
      setError(err.message || "Failed to delete project.");
    }
  };

  const handleDuplicate = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "duplicate" }),
      });
      if (!res.ok) throw new Error("Failed to duplicate project");
      await fetchProjects();
    } catch (err: any) {
      setError(err.message || "Failed to duplicate project.");
    }
  };

  const startRename = (project: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTitleId(project.id);
    setNewTitleVal(project.title);
  };

  const saveRename = async (project: Project, e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitleVal.trim()) return;
    try {
      const res = await fetch("/api/projects/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          title: newTitleVal.trim(),
          nodes: project.nodesJson,
          edges: project.edgesJson,
        }),
      });
      if (!res.ok) throw new Error("Failed to rename project");
      
      if (currentProjectId === project.id) {
        setProjectTitle(newTitleVal.trim());
      }
      setEditingTitleId(null);
      await fetchProjects();
    } catch (err: any) {
      setError(err.message || "Failed to rename project.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md pointer-events-auto select-none">
      <div 
        className="bg-[#060B15]/95 border border-white/[0.08] w-[640px] max-h-[500px] flex flex-col rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.85)] animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.06] flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded bg-[#C2EF4E]/10 text-lime-green">
              <FolderOpen size={16} />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-white uppercase tracking-wider font-sans">Project Dashboard</h3>
              <span className="text-[10px] text-white/50 block font-medium">Manage, duplicate, load, and version your ERD schema projects</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/65 hover:text-white hover:bg-white/[0.06] rounded-md text-xs p-1 px-1.5 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Errors & Alerts */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 p-scrollbar min-h-0">
          
          <div className="flex justify-between items-center mb-4">
            <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Saved Schemas ({projects.length})</span>
            
            <div className="flex gap-2">
              <button
                onClick={() => {
                  onCreateNewProject();
                  onClose();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/[0.08] hover:bg-white/[0.1] text-white text-[11px] font-bold rounded-lg transition-all"
              >
                <Plus size={12} />
                New Blank Canvas
              </button>
              <button
                onClick={() => handleSaveCurrent()}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(74,144,217,0.25)]"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save Current Design
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-white/65 gap-2">
              <Loader2 className="animate-spin text-lime-green" size={24} />
              <span className="text-xs">Loading projects...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-white/30 border border-dashed border-white/[0.08] rounded-2xl gap-2">
              <FolderOpen size={36} className="text-white/10" />
              <p className="text-xs">No projects found. Design something and click &quot;Save Current Design&quot;!</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {projects.map((project) => {
                const isActive = project.id === currentProjectId;
                const isEditingTitle = editingTitleId === project.id;

                return (
                  <div
                    key={project.id}
                    onClick={() => {
                      onLoadProject(project);
                      onClose();
                    }}
                    className={`group relative p-4 rounded-xl border transition-all cursor-pointer flex flex-col gap-2.5 ${
                      isActive
                        ? "bg-[#4A90D9]/5 border-[#4A90D9]/40 shadow-[0_0_16px_rgba(74,144,217,0.08)]"
                        : "bg-[#040810]/40 border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.01]"
                    }`}
                  >
                    {/* Project Title Block */}
                    <div className="flex items-start justify-between min-w-0">
                      {isEditingTitle ? (
                        <form
                          onSubmit={(e) => saveRename(project, e)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1.5 w-full mr-2"
                        >
                          <input
                            type="text"
                            value={newTitleVal}
                            onChange={(e) => setNewTitleVal(e.target.value)}
                            className="bg-[#050913] border border-[#4A90D9]/30 rounded px-2 py-0.5 text-xs text-white font-sans w-full outline-none"
                            autoFocus
                          />
                          <button type="submit" className="text-lime-green p-0.5"><Check size={12} /></button>
                          <button type="button" onClick={() => setEditingTitleId(null)} className="text-white/65 p-0.5">✕</button>
                        </form>
                      ) : (
                        <div className="flex flex-col min-w-0 pr-6">
                          <span className="text-xs font-bold text-white truncate group-hover:text-[#4A90D9] transition-colors">
                            {project.title}
                          </span>
                          <span className="text-[9px] text-white/35 font-mono truncate max-w-[180px]">
                            {project.rawPrompt || "Manual Schema Design"}
                          </span>
                        </div>
                      )}

                      {/* Hover Action Buttons */}
                      {!isEditingTitle && (
                        <div className="absolute top-3.5 right-3.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => startRename(project, e)}
                            className="p-1 rounded bg-white/5 border border-white/[0.06] text-white/50 hover:text-white hover:bg-white/10"
                            title="Rename"
                          >
                            <Edit2 size={10} />
                          </button>
                          <button
                            onClick={(e) => handleDuplicate(project.id, e)}
                            className="p-1 rounded bg-white/5 border border-white/[0.06] text-white/50 hover:text-white hover:bg-white/10"
                            title="Duplicate"
                          >
                            <Copy size={10} />
                          </button>
                          <button
                            onClick={(e) => handleDelete(project.id, e)}
                            className="p-1 rounded bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20"
                            title="Delete"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Stats & Meta details */}
                    <div className="flex items-center justify-between mt-1 text-[10px] text-white/65 font-mono">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <FileText size={10} />
                          {project.nodesJson?.length || 0} tables
                        </span>
                      </div>
                      <span className="flex items-center gap-1">
                        <Calendar size={10} />
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Active Badge */}
                    {isActive && (
                      <span className="absolute bottom-2.5 right-3 text-[9px] font-bold text-lime-green bg-lime-green/10 border border-lime-green/20 px-1.5 py-0.5 rounded uppercase">
                        Current
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
