"use client";

import React, { useState, useEffect } from "react";
import { PlusSquare, Component, FileCode2, X, Trash2, Key, Copy, Check, Info, Settings, ArrowUp, ArrowRightLeft } from "lucide-react";
import { Node, Edge } from "@xyflow/react";
import { parseSqlDdl } from "../../lib/sqlParser";

const SQL_TYPES = ["serial", "integer", "varchar(255)", "text", "boolean", "timestamp", "date", "float", "decimal(10,2)", "uuid", "char(36)"];
const FONT_OPTIONS = ["Vagnola Regular", "Inter", "JetBrains Mono", "Roboto", "Fira Code"];
const THEME_COLORS = [
  { name: "Lime", hex: "#C2EF4E", bg: "bg-lime-green" },
  { name: "Purple", hex: "#6A5FC1", bg: "bg-sentry-purple" },
  { name: "Coral", hex: "#FF6B6B", bg: "bg-coral-accent" },
  { name: "Slate", hex: "#64748b", bg: "bg-slate-500" },
];

interface NodeAttribute {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
}

interface UnifiedSidebarProps {
  nodes: Node[];
  setNodes: any;
  edges: Edge[];
  setEdges: any;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  showGrid: boolean;
  setShowGrid: (show: boolean) => void;
  onAutoLayout: () => void;
  onDeleteNode?: (id: string) => void;
  generatedSql: string;
  activeTab: "add" | "inspector" | "sql";
  setActiveTab: (tab: "add" | "inspector" | "sql") => void;
  onClose: () => void;
  sqlDialect: string;
  setSqlDialect: (dialect: string) => void;
  takeSnapshot: () => void;
}

export function UnifiedSidebar({
  nodes,
  setNodes,
  edges,
  setEdges,
  selectedNodeId,
  selectedEdgeId,
  setSelectedNodeId,
  setSelectedEdgeId,
  showGrid,
  setShowGrid,
  onAutoLayout,
  onDeleteNode,
  generatedSql,
  activeTab,
  setActiveTab,
  onClose,
  sqlDialect,
  setSqlDialect,
  takeSnapshot
}: UnifiedSidebarProps) {
  
  // --- ADD TAB STATES ---
  const [tableName, setTableName] = useState("");
  const [templateType, setTemplateType] = useState<string>("blank");
  const [customColumns, setCustomColumns] = useState<NodeAttribute[]>([
    { name: "id", type: "serial", isPk: true, isFk: false }
  ]);
  // View specific fields
  const [sourceTable, setSourceTable] = useState("");
  const [expression, setExpression] = useState("");

  // --- INSPECTOR NODE EDITING STATES ---
  const [editingAttr, setEditingAttr] = useState<{ idx: number; field: "name" | "type" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingNodeName, setEditingNodeName] = useState(false);
  const [newNodeName, setNewNodeName] = useState("");
  
  // Relationship Suggestions State
  const [relationshipSuggestion, setRelationshipSuggestion] = useState<{
    sourceNodeId: string;
    targetNodeId: string;
    columnName: string;
  } | null>(null);

  // Helper to find target table based on column naming conventions (e.g. user_id -> users)
  const findTargetNodeForColumn = (colName: string, currentNodeId: string) => {
    const match = colName.match(/^(.+?)(?:_id|Id|id)$/);
    if (!match) return null;
    const prefix = match[1].toLowerCase();
    
    // Pluralization / singularization simplistic checks
    const candidates = [
      prefix,
      prefix + 's',
      prefix + 'es',
      prefix.replace(/y$/, 'ies'),
      prefix.slice(0, -1) // e.g. users -> user
    ];
    
    const found = nodes.find(n => {
      if (n.id === currentNodeId) return false;
      const label = (n.data.label as string).toLowerCase();
      return candidates.includes(label);
    });
    
    return found ? found.id : null;
  };

  const acceptRelationshipSuggestion = () => {
    if (!relationshipSuggestion) return;
    const { sourceNodeId, targetNodeId, columnName } = relationshipSuggestion;
    
    // Create connection
    // Mark source column as FK
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== sourceNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      const updatedAttrs = attrs.map(attr => {
        if (attr.name === columnName) {
          return { ...attr, isFk: true };
        }
        return attr;
      });
      return { ...n, data: { ...n.data, attributes: updatedAttrs } };
    }));

    // Create edge
    const newEdge: Edge = {
      id: `edge_${sourceNodeId}_to_${targetNodeId}`,
      source: sourceNodeId,
      target: targetNodeId,
      sourceHandle: `${sourceNodeId}-${columnName}`,
      targetHandle: `${targetNodeId}-id`, // Assume target PK is 'id'
      type: "custom",
      data: {
        relationshipType: "many-to-one",
        sourceField: columnName,
        targetField: "id"
      }
    };
    
    setEdges((eds: Edge[]) => [...eds, newEdge]);
    setRelationshipSuggestion(null);
    takeSnapshot();
  };

  // --- SQL CODE IMPORT STATE ---
  const [copiedSql, setCopiedSql] = useState(false);
  const [importSql, setImportSql] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [sqlSubTab, setSqlSubTab] = useState<"preview" | "import">("preview");

  // --- APPEARANCE & GLOBAL SETTINGS STATES ---
  const [_fontOpen, _setFontOpen] = useState(false);
  const [selectedFont, setSelectedFont] = useState("Vagnola Regular");
  const [themeColor, setThemeColor] = useState("#6A5FC1");
  const [nodeOpacity, setNodeOpacity] = useState(100);
  const [autoLayout, setAutoLayout] = useState(false);

  // Apply CSS variables for theme
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--theme-color", themeColor);
    root.style.setProperty("--node-font", selectedFont === "Vagnola Regular" ? "Vagnola, sans-serif" : `${selectedFont}, sans-serif`);
    root.style.setProperty("--node-opacity", String(nodeOpacity / 100));
  }, [themeColor, selectedFont, nodeOpacity]);

  const selectedNode = selectedNodeId ? nodes.find(n => n.id === selectedNodeId) : null;
  const selectedAttrs = selectedNode ? ((selectedNode.data.attributes as NodeAttribute[]) || []) : [];
  
  const selectedEdge = selectedEdgeId ? edges.find(e => e.id === selectedEdgeId) : null;

  // --- HELPERS ---
  const uniqueName = (base: string) => {
    const names = nodes.map(n => n.data.label as string);
    let name = base;
    let i = 1;
    while (names.includes(name)) {
      name = `${base}_${i}`;
      i++;
    }
    return name;
  };

  const addNode = (label: string, attrs: NodeAttribute[]) => {
    const offset = nodes.length * 60;
    const nodeId = crypto.randomUUID ? crypto.randomUUID() : `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const newNode: Node = {
      id: nodeId,
      type: "tableMode",
      position: { x: 200 + offset, y: 150 + offset },
      data: { label, icon: "server", attributes: attrs },
    };
    setNodes((nds: Node[]) => [...nds, newNode]);
    if (autoLayout) setTimeout(onAutoLayout, 100);
    takeSnapshot();
  };

  // --- ADD TAB FIELD ACTIONS ---
  const handleAddCustomColumn = () => {
    setCustomColumns([...customColumns, {
      name: `field_${customColumns.length + 1}`,
      type: "varchar(255)",
      isPk: false,
      isFk: false
    }]);
  };

  const handleUpdateCustomColumn = (idx: number, field: keyof NodeAttribute, val: any) => {
    const updated = [...customColumns];
    updated[idx] = { ...updated[idx], [field]: val };
    setCustomColumns(updated);
  };

  const handleRemoveCustomColumn = (idx: number) => {
    setCustomColumns(customColumns.filter((_, i) => i !== idx));
  };

  const spawnMultiTablePreset = (presetName: string) => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    const baseOffset = nodes.length * 60;
    
    const createTableObj = (label: string, attrs: NodeAttribute[], xOffset: number, yOffset: number) => {
      const id = crypto.randomUUID ? crypto.randomUUID() : `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      return {
        id,
        type: "tableMode",
        position: { x: 250 + xOffset + baseOffset, y: 150 + yOffset + baseOffset },
        data: { label: uniqueName(label), icon: "server", attributes: attrs }
      };
    };

    if (presetName === "auth") {
      const users = createTableObj("users", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "username", type: "varchar(255)", isPk: false, isFk: false },
        { name: "email", type: "varchar(255)", isPk: false, isFk: false },
        { name: "password_hash", type: "varchar(255)", isPk: false, isFk: false },
        { name: "created_at", type: "timestamp", isPk: false, isFk: false }
      ], 0, 0);

      const roles = createTableObj("roles", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(100)", isPk: false, isFk: false },
        { name: "description", type: "text", isPk: false, isFk: false }
      ], 300, 0);

      const permissions = createTableObj("permissions", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(100)", isPk: false, isFk: false },
        { name: "description", type: "text", isPk: false, isFk: false }
      ], 300, 300);

      const userRoles = createTableObj("user_roles", [
        { name: "user_id", type: "integer", isPk: true, isFk: true },
        { name: "role_id", type: "integer", isPk: true, isFk: true }
      ], 150, 150);

      const rolePermissions = createTableObj("role_permissions", [
        { name: "role_id", type: "integer", isPk: true, isFk: true },
        { name: "permission_id", type: "integer", isPk: true, isFk: true }
      ], 450, 150);

      newNodes.push(users, roles, permissions, userRoles, rolePermissions);

      newEdges.push(
        { id: `edge_${userRoles.id}_to_${users.id}`, source: userRoles.id, target: users.id, sourceHandle: `${userRoles.id}-user_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "user_id", targetField: "id" } },
        { id: `edge_${userRoles.id}_to_${roles.id}`, source: userRoles.id, target: roles.id, sourceHandle: `${userRoles.id}-role_id`, targetHandle: `${roles.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "role_id", targetField: "id" } },
        { id: `edge_${rolePermissions.id}_to_${roles.id}`, source: rolePermissions.id, target: roles.id, sourceHandle: `${rolePermissions.id}-role_id`, targetHandle: `${roles.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "role_id", targetField: "id" } },
        { id: `edge_${rolePermissions.id}_to_${permissions.id}`, source: rolePermissions.id, target: permissions.id, sourceHandle: `${rolePermissions.id}-permission_id`, targetHandle: `${permissions.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "permission_id", targetField: "id" } }
      );
    } else if (presetName === "ecommerce") {
      const users = createTableObj("users", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "email", type: "varchar(255)", isPk: false, isFk: false },
        { name: "name", type: "varchar(255)", isPk: false, isFk: false }
      ], 0, 0);

      const products = createTableObj("products", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(255)", isPk: false, isFk: false },
        { name: "price", type: "decimal(10,2)", isPk: false, isFk: false },
        { name: "stock", type: "integer", isPk: false, isFk: false }
      ], 600, 0);

      const orders = createTableObj("orders", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "user_id", type: "integer", isPk: false, isFk: true },
        { name: "status", type: "varchar(50)", isPk: false, isFk: false },
        { name: "created_at", type: "timestamp", isPk: false, isFk: false }
      ], 200, 200);

      const orderItems = createTableObj("order_items", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "order_id", type: "integer", isPk: false, isFk: true },
        { name: "product_id", type: "integer", isPk: false, isFk: true },
        { name: "quantity", type: "integer", isPk: false, isFk: false },
        { name: "price", type: "decimal(10,2)", isPk: false, isFk: false }
      ], 450, 200);

      newNodes.push(users, products, orders, orderItems);

      newEdges.push(
        { id: `edge_${orders.id}_to_${users.id}`, source: orders.id, target: users.id, sourceHandle: `${orders.id}-user_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "user_id", targetField: "id" } },
        { id: `edge_${orderItems.id}_to_${orders.id}`, source: orderItems.id, target: orders.id, sourceHandle: `${orderItems.id}-order_id`, targetHandle: `${orders.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "order_id", targetField: "id" } },
        { id: `edge_${orderItems.id}_to_${products.id}`, source: orderItems.id, target: products.id, sourceHandle: `${orderItems.id}-product_id`, targetHandle: `${products.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "product_id", targetField: "id" } }
      );
    } else if (presetName === "cms") {
      const users = createTableObj("users", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "username", type: "varchar(100)", isPk: false, isFk: false },
        { name: "role", type: "varchar(50)", isPk: false, isFk: false }
      ], 0, 0);

      const posts = createTableObj("posts", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "author_id", type: "integer", isPk: false, isFk: true },
        { name: "title", type: "varchar(255)", isPk: false, isFk: false },
        { name: "content", type: "text", isPk: false, isFk: false },
        { name: "status", type: "varchar(50)", isPk: false, isFk: false }
      ], 250, 0);

      const comments = createTableObj("comments", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "post_id", type: "integer", isPk: false, isFk: true },
        { name: "user_id", type: "integer", isPk: false, isFk: true },
        { name: "comment", type: "text", isPk: false, isFk: false }
      ], 125, 250);

      const tags = createTableObj("tags", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(100)", isPk: false, isFk: false }
      ], 550, 0);

      const postTags = createTableObj("post_tags", [
        { name: "post_id", type: "integer", isPk: true, isFk: true },
        { name: "tag_id", type: "integer", isPk: true, isFk: true }
      ], 400, 200);

      newNodes.push(users, posts, comments, tags, postTags);

      newEdges.push(
        { id: `edge_${posts.id}_to_${users.id}`, source: posts.id, target: users.id, sourceHandle: `${posts.id}-author_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "author_id", targetField: "id" } },
        { id: `edge_${comments.id}_to_${posts.id}`, source: comments.id, target: posts.id, sourceHandle: `${comments.id}-post_id`, targetHandle: `${posts.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "post_id", targetField: "id" } },
        { id: `edge_${comments.id}_to_${users.id}`, source: comments.id, target: users.id, sourceHandle: `${comments.id}-user_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "user_id", targetField: "id" } },
        { id: `edge_${postTags.id}_to_${posts.id}`, source: postTags.id, target: posts.id, sourceHandle: `${postTags.id}-post_id`, targetHandle: `${posts.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "post_id", targetField: "id" } },
        { id: `edge_${postTags.id}_to_${tags.id}`, source: postTags.id, target: tags.id, sourceHandle: `${postTags.id}-tag_id`, targetHandle: `${tags.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "tag_id", targetField: "id" } }
      );
    } else if (presetName === "inventory") {
      const warehouses = createTableObj("warehouses", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(255)", isPk: false, isFk: false },
        { name: "location", type: "varchar(255)", isPk: false, isFk: false }
      ], 0, 0);

      const products = createTableObj("products", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "sku", type: "varchar(100)", isPk: false, isFk: false },
        { name: "description", type: "text", isPk: false, isFk: false }
      ], 450, 0);

      const inventoryLevels = createTableObj("inventory_levels", [
        { name: "warehouse_id", type: "integer", isPk: true, isFk: true },
        { name: "product_id", type: "integer", isPk: true, isFk: true },
        { name: "quantity", type: "integer", isPk: false, isFk: false }
      ], 225, 200);

      const stockMovements = createTableObj("stock_movements", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "product_id", type: "integer", isPk: false, isFk: true },
        { name: "from_warehouse_id", type: "integer", isPk: false, isFk: true },
        { name: "to_warehouse_id", type: "integer", isPk: false, isFk: true },
        { name: "quantity", type: "integer", isPk: false, isFk: false },
        { name: "moved_at", type: "timestamp", isPk: false, isFk: false }
      ], 225, 400);

      newNodes.push(warehouses, products, inventoryLevels, stockMovements);

      newEdges.push(
        { id: `edge_${inventoryLevels.id}_to_${warehouses.id}`, source: inventoryLevels.id, target: warehouses.id, sourceHandle: `${inventoryLevels.id}-warehouse_id`, targetHandle: `${warehouses.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "warehouse_id", targetField: "id" } },
        { id: `edge_${inventoryLevels.id}_to_${products.id}`, source: inventoryLevels.id, target: products.id, sourceHandle: `${inventoryLevels.id}-product_id`, targetHandle: `${products.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "product_id", targetField: "id" } },
        { id: `edge_${stockMovements.id}_to_${products.id}`, source: stockMovements.id, target: products.id, sourceHandle: `${stockMovements.id}-product_id`, targetHandle: `${products.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "product_id", targetField: "id" } },
        { id: `edge_${stockMovements.id}_to_from_${warehouses.id}`, source: stockMovements.id, target: warehouses.id, sourceHandle: `${stockMovements.id}-from_warehouse_id`, targetHandle: `${warehouses.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "from_warehouse_id", targetField: "id" } },
        { id: `edge_${stockMovements.id}_to_to_${warehouses.id}`, source: stockMovements.id, target: warehouses.id, sourceHandle: `${stockMovements.id}-to_warehouse_id`, targetHandle: `${warehouses.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "to_warehouse_id", targetField: "id" } }
      );
    } else if (presetName === "social") {
      const users = createTableObj("users", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "username", type: "varchar(100)", isPk: false, isFk: false }
      ], 0, 0);

      const profiles = createTableObj("profiles", [
        { name: "user_id", type: "integer", isPk: true, isFk: true },
        { name: "bio", type: "text", isPk: false, isFk: false },
        { name: "avatar_url", type: "varchar(255)", isPk: false, isFk: false }
      ], 0, 250);

      const follows = createTableObj("follows", [
        { name: "follower_id", type: "integer", isPk: true, isFk: true },
        { name: "following_id", type: "integer", isPk: true, isFk: true }
      ], 250, 250);

      const posts = createTableObj("posts", [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "user_id", type: "integer", isPk: false, isFk: true },
        { name: "body", type: "text", isPk: false, isFk: false }
      ], 300, 0);

      const likes = createTableObj("likes", [
        { name: "user_id", type: "integer", isPk: true, isFk: true },
        { name: "post_id", type: "integer", isPk: true, isFk: true }
      ], 450, 150);

      newNodes.push(users, profiles, follows, posts, likes);

      newEdges.push(
        { id: `edge_${profiles.id}_to_${users.id}`, source: profiles.id, target: users.id, sourceHandle: `${profiles.id}-user_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "one-to-one", sourceField: "user_id", targetField: "id" } },
        { id: `edge_${follows.id}_to_follower_${users.id}`, source: follows.id, target: users.id, sourceHandle: `${follows.id}-follower_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "follower_id", targetField: "id" } },
        { id: `edge_${follows.id}_to_following_${users.id}`, source: follows.id, target: users.id, sourceHandle: `${follows.id}-following_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "following_id", targetField: "id" } },
        { id: `edge_${posts.id}_to_${users.id}`, source: posts.id, target: users.id, sourceHandle: `${posts.id}-user_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "user_id", targetField: "id" } },
        { id: `edge_${likes.id}_to_user_${users.id}`, source: likes.id, target: users.id, sourceHandle: `${likes.id}-user_id`, targetHandle: `${users.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "user_id", targetField: "id" } },
        { id: `edge_${likes.id}_to_post_${posts.id}`, source: likes.id, target: posts.id, sourceHandle: `${likes.id}-post_id`, targetHandle: `${posts.id}-id`, type: "custom", data: { relationshipType: "many-to-one", sourceField: "post_id", targetField: "id" } }
      );
    }

    setNodes((nds: Node[]) => [...nds, ...newNodes]);
    setEdges((eds: Edge[]) => [...eds, ...newEdges]);
    if (autoLayout) setTimeout(onAutoLayout, 100);
    takeSnapshot();
  };

  const handleCreateTable = () => {
    const isMultiTable = ["auth", "ecommerce", "cms", "inventory", "social"].includes(templateType);
    if (isMultiTable) {
      spawnMultiTablePreset(templateType);
      setTableName("");
      return;
    }

    let name = uniqueName(tableName.trim() || "new_table");
    let attrs: NodeAttribute[] = [];

    if (templateType === "blank") {
      attrs = [...customColumns];
      if (attrs.length === 0) {
        attrs.push({ name: "id", type: "serial", isPk: true, isFk: false });
      }
    } else if (templateType === "users") {
      name = uniqueName(tableName.trim() || "users");
      attrs = [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(255)", isPk: false, isFk: false },
        { name: "email", type: "varchar(255)", isPk: false, isFk: false },
        { name: "password_hash", type: "varchar(255)", isPk: false, isFk: false },
        { name: "created_at", type: "timestamp", isPk: false, isFk: false },
      ];
    } else if (templateType === "products") {
      name = uniqueName(tableName.trim() || "products");
      attrs = [
        { name: "id", type: "serial", isPk: true, isFk: false },
        { name: "name", type: "varchar(255)", isPk: false, isFk: false },
        { name: "price", type: "decimal(10,2)", isPk: false, isFk: false },
        { name: "stock", type: "integer", isPk: false, isFk: false },
        { name: "category_id", type: "integer", isPk: false, isFk: true },
      ];
    } else if (templateType === "view") {
      name = uniqueName(tableName.trim() || "computed_view");
      attrs = [
        { name: "view_id", type: "serial", isPk: true, isFk: false },
        { name: "source_table", type: "varchar(100)", isPk: false, isFk: false },
        { name: "expression", type: "text", isPk: false, isFk: false },
      ];
    }

    addNode(name, attrs);
    
    // Reset forms
    setTableName("");
    setCustomColumns([{ name: "id", type: "serial", isPk: true, isFk: false }]);
    if (templateType === "view") {
      setSourceTable("");
      setExpression("");
    }
  };

  // --- ATTRIBUTE CRUD (INSPECTOR) ---
  const updateAttr = (idx: number, field: string, value: string | boolean) => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      attrs[idx] = { ...attrs[idx], [field]: value };
      return { ...n, data: { ...n.data, attributes: attrs } };
    }));

    // Trigger relationship suggestion if column name is renamed to end in _id
    if (field === "name" && typeof value === "string") {
      const targetId = findTargetNodeForColumn(value, selectedNodeId);
      if (targetId) {
        // Check if edge already exists
        const edgeExists = edges.some(e => 
          (e.source === selectedNodeId && e.target === targetId) ||
          (e.source === targetId && e.target === selectedNodeId)
        );
        if (!edgeExists) {
          setRelationshipSuggestion({
            sourceNodeId: selectedNodeId,
            targetNodeId: targetId,
            columnName: value
          });
        }
      }
    }
    takeSnapshot();
  };

  const deleteAttr = (idx: number) => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      attrs.splice(idx, 1);
      return { ...n, data: { ...n.data, attributes: attrs } };
    }));
    takeSnapshot();
  };

  const addAttr = () => {
    if (!selectedNodeId) return;
    setNodes((nds: Node[]) => nds.map(n => {
      if (n.id !== selectedNodeId) return n;
      const attrs = [...((n.data.attributes as NodeAttribute[]) || [])];
      const newAttr = { name: `field_${attrs.length + 1}`, type: "varchar(255)", isPk: false, isFk: false };
      return { ...n, data: { ...n.data, attributes: [...attrs, newAttr] } };
    }));
    takeSnapshot();
  };

  // --- NODE ACTIONS ---
  const renameNode = () => {
    if (!selectedNodeId || !newNodeName.trim()) return;
    setNodes((nds: Node[]) => nds.map(n =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, label: newNodeName } } : n
    ));
    setEditingNodeName(false);
    takeSnapshot();
  };

  const duplicateNode = () => {
    if (!selectedNode) return;
    const name = uniqueName((selectedNode.data.label as string) + "_copy");
    addNode(name, [...((selectedNode.data.attributes as NodeAttribute[]) || [])]);
  };

  const deleteNode = () => {
    if (!selectedNodeId) return;
    if (onDeleteNode) {
      onDeleteNode(selectedNodeId);
    } else {
      setNodes((nds: Node[]) => nds.filter(n => n.id !== selectedNodeId));
      setEdges((eds: Edge[]) => eds.filter(e => e.source !== selectedNodeId && e.target !== selectedNodeId));
      setSelectedNodeId(null);
    }
    takeSnapshot();
  };

  // --- EDGE ACTIONS & RELATIONSHIP EDITING ---
  const updateEdgeData = (field: string, value: any) => {
    if (!selectedEdgeId) return;
    setEdges((eds: Edge[]) => eds.map(e => {
      if (e.id !== selectedEdgeId) return e;
      return {
        ...e,
        data: {
          ...e.data,
          [field]: value
        }
      };
    }));
    takeSnapshot();
  };

  const handleRelationshipTypeChange = (type: string) => {
    updateEdgeData("relationshipType", type);
  };

  const deleteEdge = () => {
    if (!selectedEdgeId) return;
    setEdges((eds: Edge[]) => eds.filter(e => e.id !== selectedEdgeId));
    setSelectedEdgeId(null);
    takeSnapshot();
  };

  // --- SQL IMPORT HANDLER ---
  const handleImportSql = () => {
    setImportStatus("");
    if (!importSql.trim()) {
      setImportStatus("Error: Please paste a valid SQL DDL script.");
      return;
    }

    try {
      const parsed = parseSqlDdl(importSql);
      if (parsed.entities.length === 0) {
        setImportStatus("Error: No CREATE TABLE statements found in parsed SQL.");
        return;
      }

      // 1. Generate table name to UUID map
      const tableIdMap = new Map<string, string>();
      parsed.entities.forEach((entity: any) => {
        const id = crypto.randomUUID ? crypto.randomUUID() : `table_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        tableIdMap.set(entity.name.toLowerCase(), id);
      });

      // Convert parsed schema to React Flow nodes and edges
      const newNodes: Node[] = parsed.entities.map((entity, index) => {
        const nodeId = tableIdMap.get(entity.name.toLowerCase())!;
        return {
          id: nodeId,
          type: "tableMode",
          position: { x: 100 + index * 80, y: 100 + index * 60 },
          data: {
            label: entity.name,
            icon: "server",
            attributes: entity.attributes.map(attr => ({
              name: attr.name,
              type: attr.dataType,
              isPk: attr.isPrimaryKey,
              isFk: attr.isForeignKey
            }))
          }
        };
      });

      const newEdges: Edge[] = parsed.relationships.map((rel, index) => {
        const sourceId = tableIdMap.get(rel.toEntity.toLowerCase());
        const targetId = tableIdMap.get(rel.fromEntity.toLowerCase());
        return {
          id: `e-${Date.now()}-${index}`,
          source: sourceId || rel.toEntity,
          target: targetId || rel.fromEntity,
          type: "crowsFoot",
          data: {
            relationshipType: rel.type,
            sourceColumn: rel.referencedKey || "id",
            targetColumn: rel.foreignKey
          }
        };
      });

      setNodes(newNodes);
      setEdges(newEdges);
      setImportSql("");
      setImportStatus(`Success: Imported ${newNodes.length} tables and ${newEdges.length} relationships.`);
      setTimeout(() => setImportStatus(""), 4000);
      onAutoLayout();
      takeSnapshot();
    } catch (err: any) {
      setImportStatus(`Error: ${err.message || "Failed to parse SQL."}`);
    }
  };

  // --- COPY SQL HELPERS ---
  const handleCopySql = () => {
    navigator.clipboard.writeText(generatedSql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div 
      id="design-unified-sidebar"
      className="absolute right-6 top-24 bottom-6 w-[340px] z-40 bg-[#060B15]/90 backdrop-blur-xl border border-white/[0.08] flex flex-col pointer-events-auto rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.7)] duration-300 select-none animate-in fade-in slide-in-from-right-4"
    >
      {/* Sidebar Tabs */}
      <div className="flex border-b border-white/[0.06] p-2 gap-1 bg-white/[0.01] rounded-t-2xl shrink-0">
        <button
          onClick={() => { setActiveTab("add"); setSelectedNodeId(null); setSelectedEdgeId(null); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
            activeTab === "add" 
              ? "bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-white shadow-inner" 
              : "text-white/60 hover:text-white hover:bg-white/[0.03] border border-transparent"
          }`}
        >
          <PlusSquare size={13} />
          Add
        </button>
        <button
          onClick={() => setActiveTab("inspector")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
            activeTab === "inspector" 
              ? "bg-[#4A90D9]/15 border border-[#4A90D9]/30 text-white shadow-inner" 
              : "text-white/60 hover:text-white hover:bg-white/[0.03] border border-transparent"
          }`}
        >
          <Component size={13} />
          Inspector
        </button>
        {/* SQL moved to left workspace panel — removed from right sidebar */}
        
        <button 
          onClick={onClose} 
          className="p-1.5 text-white/65 hover:text-white hover:bg-white/[0.06] rounded-xl transition-all self-center"
          aria-label="Close sidebar"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-5 p-scrollbar flex flex-col gap-5">
        
        {/* ==================== ADD TAB ==================== */}
        {activeTab === "add" && (
          <div className="space-y-4 flex flex-col">
            <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
              <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Add Canvas Table</span>
              <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Builder</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Table Name</label>
              <input 
                value={tableName} 
                onChange={e => setTableName(e.target.value)} 
                placeholder="e.g. orders"
                className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-[#4A90D9]/50 focus:bg-white/[0.04] transition-all" 
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Insertion Template</label>
              <div className="relative">
                <select 
                  value={templateType} 
                  onChange={e => setTemplateType(e.target.value)}
                  className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50 transition-all"
                >
                  <option value="blank">Custom Columns Table</option>
                  <option value="users">Users Preset (Single Table)</option>
                  <option value="products">Products Preset (Single Table)</option>
                  <option value="auth">Auth & RBAC Preset (5 Connected Tables)</option>
                  <option value="ecommerce">E-commerce Preset (4 Connected Tables)</option>
                  <option value="cms">Blog & CMS Preset (5 Connected Tables)</option>
                  <option value="inventory">Inventory Preset (4 Connected Tables)</option>
                  <option value="social">Social Media Preset (5 Connected Tables)</option>
                  <option value="view">SQL View (Computed)</option>
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
              </div>
            </div>

            {/* Custom Table Builder fields list */}
            {templateType === "blank" && (
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center border-b border-white/[0.04] pb-1.5">
                  <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Columns Builder</span>
                  <button 
                    onClick={handleAddCustomColumn}
                    className="text-[10px] text-[#4A90D9] hover:text-[#4A90D9]/80 font-bold bg-[#4A90D9]/5 hover:bg-[#4A90D9]/10 px-2 py-0.5 rounded border border-[#4A90D9]/25 transition-all"
                  >
                    + Add Field
                  </button>
                </div>

                <div className="space-y-2 max-h-[220px] overflow-y-auto p-scrollbar pr-1">
                  {customColumns.map((col, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-white/[0.01] border border-white/[0.04] p-1.5 rounded-xl">
                      {/* Name */}
                      <input 
                        type="text"
                        value={col.name}
                        onChange={(e) => handleUpdateCustomColumn(idx, "name", e.target.value)}
                        placeholder="col_name"
                        className="flex-1 bg-[#040810] border border-white/[0.08] rounded-lg px-2 py-1 text-[11px] text-white outline-none focus:border-[#4A90D9]/30"
                      />

                      {/* Type */}
                      <select
                        value={col.type}
                        onChange={(e) => handleUpdateCustomColumn(idx, "type", e.target.value)}
                        className="w-24 bg-[#040810] border border-white/[0.08] rounded-lg px-1.5 py-1 text-[11px] text-white outline-none"
                      >
                        {SQL_TYPES.map(t => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>

                      {/* PK */}
                      <button
                        onClick={() => handleUpdateCustomColumn(idx, "isPk", !col.isPk)}
                        title="Toggle Primary Key"
                        className={`p-1 rounded border transition-colors ${
                          col.isPk 
                            ? "bg-yellow-400/20 border-yellow-400/40 text-yellow-400" 
                            : "bg-white/[0.02] border-white/[0.06] text-white/30 hover:text-white"
                        }`}
                      >
                        <Key size={10} />
                      </button>

                      {/* Trash */}
                      <button
                        onClick={() => handleRemoveCustomColumn(idx)}
                        disabled={customColumns.length === 1}
                        className="p-1 rounded border border-white/[0.06] text-white/30 hover:text-red-400 hover:border-red-400/20 disabled:opacity-20"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Calculated view source table selector */}
            {templateType === "view" && (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Source Table</label>
                  <div className="relative">
                    <select 
                      value={sourceTable} 
                      onChange={e => setSourceTable(e.target.value)}
                      className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50"
                    >
                      <option value="">Select source table...</option>
                      {nodes.map(n => (
                        <option key={n.id} value={n.data.label as string}>
                          {n.data.label as string}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Expression / Filter</label>
                  <textarea 
                    value={expression} 
                    onChange={e => setExpression(e.target.value)} 
                    placeholder="e.g. status = 'active'"
                    className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg px-3 py-2.5 text-xs text-white placeholder:text-white/20 outline-none focus:border-[#4A90D9]/50 focus:bg-white/[0.04] transition-all resize-none h-16 p-scrollbar" 
                  />
                </div>
              </>
            )}

            <button 
              onClick={handleCreateTable} 
              className="w-full mt-4 py-2.5 bg-[#4A90D9] text-[#C9C8C7] hover:bg-[#4A90D9]/90 text-[11px] font-bold rounded-lg transition-all shadow-[0_4px_12px_rgba(74,144,217,0.25)] flex items-center justify-center gap-1.5"
            >
              <PlusSquare size={13} />
              {templateType === "view" ? "Create Computed View" : "Spawn Custom Table"}
            </button>

            <div className="h-px bg-white/[0.06] my-4" />

            <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
              <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Add Annotations</span>
              <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Note</span>
            </div>

            <button 
              onClick={() => {
                const offset = nodes.length * 60;
                const nodeId = crypto.randomUUID ? crypto.randomUUID() : `note_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                const newNote: Node = {
                  id: nodeId,
                  type: "stickyNote",
                  position: { x: 200 + offset, y: 150 + offset },
                  data: { text: "Double-click to edit...", colorIndex: 0 },
                };
                setNodes((nds: any) => [...nds, newNote]);
                takeSnapshot();
              }} 
              className="w-full py-2.5 bg-amber-500/10 border border-amber-500/25 hover:bg-amber-500/20 text-amber-300 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-8.5L15.5 3z" />
                <path d="M15 3v6h6" />
              </svg>
              Add Sticky Note
            </button>

            <button 
              onClick={() => {
                const offset = nodes.length * 60;
                const nodeId = crypto.randomUUID ? crypto.randomUUID() : `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                const newGroup: Node = {
                  id: nodeId,
                  type: "tableGroup",
                  position: { x: 150 + offset, y: 100 + offset },
                  style: { width: 450, height: 350 },
                  data: { label: "New Module Group", colorIndex: 0 },
                };
                setNodes((nds: any) => [...nds, newGroup]);
                takeSnapshot();
              }} 
              className="w-full mt-2 py-2.5 bg-blue-500/10 border border-blue-500/25 hover:bg-blue-500/20 text-blue-300 text-[11px] font-bold rounded-lg transition-all flex items-center justify-center gap-1.5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" strokeDasharray="3 3" />
              </svg>
              Add Table Group
            </button>
          </div>
        )}

        {/* ==================== INSPECTOR TAB ==================== */}
        {activeTab === "inspector" && (
          <div className="space-y-4 flex flex-col">
            
            {/* 1. NODE SELECTED */}
            {selectedNode && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
                  <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Table Attributes</span>
                  <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Entity</span>
                </div>

                {/* Table Name Title Inline Editor */}
                <div className="space-y-1.5 bg-white/[0.01] border border-white/[0.04] p-3 rounded-xl">
                  <span className="text-[10px] text-white/45 uppercase font-sans tracking-wide block">Physical Table Name</span>
                  {editingNodeName ? (
                    <div className="flex items-center gap-1.5">
                      <input 
                        type="text" 
                        value={newNodeName} 
                        onChange={e => setNewNodeName(e.target.value)}
                        className="flex-1 bg-white/[0.06] border border-[#4A90D9]/40 rounded-lg px-2.5 py-1 text-xs text-[#C9C8C7] font-mono outline-none" 
                      />
                      <button onClick={renameNode} className="p-1 rounded bg-[#4A90D9] text-white"><Check size={12} /></button>
                      <button onClick={() => setEditingNodeName(false)} className="p-1 rounded bg-white/5 text-white/60"><X size={12} /></button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[#C9C8C7] font-mono font-bold truncate drop-shadow-[0_0_6px_rgba(74,144,217,0.2)]">
                        {selectedNode.data.label as string}
                      </span>
                      <button 
                        onClick={() => { setNewNodeName(selectedNode.data.label as string); setEditingNodeName(true); }}
                        className="text-[10px] text-[#4A90D9] hover:underline"
                      >
                        Rename
                      </button>
                    </div>
                  )}
                </div>

                {/* Columns Attribute List */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center border-b border-white/[0.04] pb-1">
                    <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Columns ({selectedAttrs.length})</span>
                    <button 
                      onClick={addAttr}
                      className="text-[9px] text-[#4A90D9] font-bold bg-[#4A90D9]/5 hover:bg-[#4A90D9]/10 px-2 py-0.5 rounded transition-all"
                    >
                      + Add Field
                    </button>
                  </div>

                  <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 p-scrollbar">
                    {selectedAttrs.length === 0 ? (
                      <div className="text-xs text-white/30 italic py-2 text-center">No columns defined. Click Add Field above.</div>
                    ) : (
                      selectedAttrs.map((attr, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 bg-white/[0.005] border border-white/[0.04] p-1.5 rounded-xl hover:bg-white/[0.02] transition-all">
                          {editingAttr?.idx === idx && editingAttr.field === "name" ? (
                            <input 
                              type="text" 
                              value={editValue} 
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => { updateAttr(idx, "name", editValue); setEditingAttr(null); }}
                              onKeyDown={e => e.key === 'Enter' && {}}
                              autoFocus
                              className="flex-1 bg-white/[0.06] border border-[#4A90D9]/30 rounded px-1.5 py-0.5 text-[11px] text-white font-mono outline-none" 
                            />
                          ) : (
                            <span 
                              onClick={() => { setEditingAttr({ idx, field: "name" }); setEditValue(attr.name); }}
                              className="flex-1 text-[11px] text-white/70 font-mono cursor-pointer hover:text-white truncate"
                            >
                              {attr.name}
                            </span>
                          )}

                          <select
                            value={attr.type}
                            onChange={e => updateAttr(idx, "type", e.target.value)}
                            className="bg-[#050913] border border-white/[0.1] rounded px-1 py-0.5 text-[10px] text-white/70 font-mono outline-none"
                          >
                            {SQL_TYPES.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>

                          {/* PK Toggle */}
                          <button
                            onClick={() => updateAttr(idx, "isPk", !attr.isPk)}
                            className={`p-1 rounded transition-colors ${attr.isPk ? "text-yellow-400 bg-yellow-400/10" : "text-white/35 hover:text-white/65"}`}
                          >
                            <Key size={10} />
                          </button>

                          {/* Delete Field */}
                          <button
                            onClick={() => deleteAttr(idx)}
                            className="p-1 rounded text-white/20 hover:text-red-400"
                          >
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Relationship Suggestion */}
                {relationshipSuggestion && (
                  <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-3 text-xs space-y-2 animate-in slide-in-from-top-2 duration-200">
                    <div className="text-white/80 leading-relaxed">
                      Detected column <span className="font-mono text-yellow-400 font-bold">{relationshipSuggestion.columnName}</span>. Connect to <span className="font-mono text-blue-400 font-bold">{nodes.find(n => n.id === relationshipSuggestion.targetNodeId)?.data.label as string}</span> table?
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={acceptRelationshipSuggestion}
                        className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold transition-all shadow-[0_2px_8px_rgba(79,70,229,0.3)]"
                      >
                        Accept Suggestion
                      </button>
                      <button 
                        onClick={() => setRelationshipSuggestion(null)}
                        className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-white/70 rounded text-[10px] transition-all"
                      >
                        Ignore
                      </button>
                    </div>
                  </div>
                )}

                {/* === Table Color & Domain Group === */}
                <div className="space-y-3 border-t border-white/[0.05] pt-3">
                  <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Color & Domain Group</span>

                  {/* Color Palette */}
                  <div className="flex items-center gap-2">
                    {[
                      { name: "Lavender",  hex: "#B8A9E8" },
                      { name: "Emerald",   hex: "#6EE7B7" },
                      { name: "Coral",     hex: "#FCA5A5" },
                      { name: "Amber",     hex: "#FCD34D" },
                      { name: "Sky Blue",  hex: "#7DD3FC" },
                    ].map((c) => {
                      const currentColor = (selectedNode.data.color as string) || "";
                      const isSelected = currentColor === c.hex;
                      return (
                        <button
                          key={c.hex}
                          title={c.name}
                          onClick={() => {
                            setNodes((nds: Node[]) =>
                              nds.map((n) =>
                                n.id === selectedNodeId
                                  ? { ...n, data: { ...n.data, color: isSelected ? "" : c.hex } }
                                  : n
                              )
                            );
                            takeSnapshot();
                          }}
                          className={`w-6 h-6 rounded-full border-2 transition-all duration-200 ${
                            isSelected
                              ? "border-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.3)]"
                              : "border-white/10 hover:border-white/40 hover:scale-105"
                          }`}
                          style={{ backgroundColor: c.hex }}
                        />
                      );
                    })}

                    {/* Custom Color Picker */}
                    <div className="relative w-6 h-6 rounded-full border border-dashed border-white/20 hover:border-white/40 hover:scale-105 flex items-center justify-center cursor-pointer overflow-hidden transition-all duration-200">
                      <input
                        type="color"
                        value={(selectedNode.data.color as string) || "#6a5fc1"}
                        onChange={(e) => {
                          const val = e.target.value;
                          setNodes((nds: Node[]) =>
                            nds.map((n) =>
                              n.id === selectedNodeId
                                ? { ...n, data: { ...n.data, color: val } }
                                : n
                            )
                          );
                        }}
                        onBlur={() => takeSnapshot()}
                        className="absolute inset-0 opacity-0 cursor-pointer scale-150"
                        title="Choose custom color"
                      />
                      <span className="text-[10px] text-white/40 pointer-events-none">+</span>
                    </div>

                    {/* Clear color button */}
                    {(selectedNode.data.color as string) && (
                      <button
                        title="Clear color"
                        onClick={() => {
                          setNodes((nds: Node[]) =>
                            nds.map((n) =>
                              n.id === selectedNodeId
                                ? { ...n, data: { ...n.data, color: "" } }
                                : n
                            )
                          );
                          takeSnapshot();
                        }}
                        className="w-6 h-6 rounded-full border border-dashed border-white/20 flex items-center justify-center text-white/30 hover:text-white/60 hover:border-white/40 transition-all text-[10px]"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Group Label Input */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="e.g. Auth Module, Billing..."
                      value={(selectedNode.data.group as string) || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNodes((nds: Node[]) =>
                          nds.map((n) =>
                            n.id === selectedNodeId
                              ? { ...n, data: { ...n.data, group: val } }
                              : n
                          )
                        );
                      }}
                      onBlur={() => takeSnapshot()}
                      className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2.5 py-1.5 text-[11px] text-white/80 placeholder-white/25 outline-none focus:border-[#4A90D9]/40 transition-colors font-sans"
                    />
                  </div>
                </div>

                {/* Seed Data Section */}
                <div className="space-y-3 border-t border-white/[0.05] pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Seed Data Configuration</span>
                    <button
                      onClick={() => {
                        const newRow = selectedAttrs.reduce((acc, attr) => {
                          acc[attr.name] = attr.type.includes("int") || attr.type.includes("serial") ? 1 : "";
                          return acc;
                        }, {} as any);
                        
                        const currentSeed = (selectedNode.data.seedData as any[]) || [];
                        const updatedSeed = [...currentSeed, newRow];
                        setNodes((nds: Node[]) => nds.map(n => {
                          if (n.id === selectedNodeId) {
                            return { ...n, data: { ...n.data, seedData: updatedSeed } };
                          }
                          return n;
                        }));
                        takeSnapshot();
                      }}
                      className="text-[9px] text-[#4A90D9] font-bold bg-[#4A90D9]/5 hover:bg-[#4A90D9]/10 px-2 py-0.5 rounded transition-all"
                    >
                      + Add Row
                    </button>
                  </div>

                  {((selectedNode.data.seedData as any[]) || []).length === 0 ? (
                    <div className="text-[11px] text-white/40 italic text-center py-2 bg-white/[0.01] rounded-lg border border-dashed border-white/5">
                      No seed data configured for this entity.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border border-white/[0.06] rounded-lg bg-[#040810]/50 max-h-[180px] p-scrollbar">
                      <table className="w-full text-left text-[10px] border-collapse">
                        <thead>
                          <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                            {selectedAttrs.map(attr => (
                              <th key={attr.name} className="px-2 py-1.5 font-mono text-white/50 border-r border-white/[0.06] whitespace-nowrap">
                                {attr.name}
                              </th>
                            ))}
                            <th className="px-2 py-1.5 text-right text-white/50">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {((selectedNode.data.seedData as any[]) || []).map((row, rowIdx) => (
                            <tr key={rowIdx} className="border-b border-white/[0.04] hover:bg-white/[0.01]">
                              {selectedAttrs.map(attr => (
                                <td key={attr.name} className="px-1 py-1 border-r border-white/[0.04]">
                                  <input
                                    type={attr.type.includes("int") || attr.type.includes("serial") ? "number" : "text"}
                                    value={row[attr.name] !== undefined ? row[attr.name] : ""}
                                    onChange={(e) => {
                                      const val = attr.type.includes("int") || attr.type.includes("serial") ? Number(e.target.value) : e.target.value;
                                      const currentSeed = (selectedNode.data.seedData as any[]) || [];
                                      const updatedSeed = currentSeed.map((r, idx) => {
                                        if (idx === rowIdx) {
                                          return { ...r, [attr.name]: val };
                                        }
                                        return r;
                                      });
                                      setNodes((nds: Node[]) => nds.map(n => {
                                        if (n.id === selectedNodeId) {
                                          return { ...n, data: { ...n.data, seedData: updatedSeed } };
                                        }
                                        return n;
                                      }));
                                      takeSnapshot();
                                    }}
                                    className="w-full min-w-[60px] bg-transparent border-0 outline-none px-1 text-white/80 focus:text-white"
                                  />
                                </td>
                              ))}
                              <td className="px-2 py-1 text-right">
                                <button
                                  onClick={() => {
                                    const currentSeed = (selectedNode.data.seedData as any[]) || [];
                                    const updatedSeed = currentSeed.filter((_, idx) => idx !== rowIdx);
                                    setNodes((nds: Node[]) => nds.map(n => {
                                      if (n.id === selectedNodeId) {
                                        return { ...n, data: { ...n.data, seedData: updatedSeed } };
                                      }
                                      return n;
                                    }));
                                    takeSnapshot();
                                  }}
                                  className="text-red-400 hover:text-red-300"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Appearance Swatches & Settings Accordion */}
                <div className="space-y-3 border-t border-white/[0.05] pt-3">
                  <span className="text-[10px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Entity Appearance</span>
                  
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-white/65 font-sans font-medium">Color Accent</span>
                    <div className="flex gap-2">
                      {THEME_COLORS.map(color => (
                        <button
                          key={color.name}
                          onClick={() => setThemeColor(color.hex)}
                          className={`w-4 h-4 rounded-full border transition-all ${color.bg} ${
                            themeColor === color.hex ? "ring-2 ring-white scale-110" : "border-white/20 hover:scale-105"
                          }`}
                          title={color.name}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Node Operations */}
                <div className="flex gap-2 pt-2 border-t border-white/[0.05]">
                  <button 
                    onClick={duplicateNode}
                    className="flex-1 py-2 bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] text-white text-[11px] font-bold rounded-lg transition-all"
                  >
                    Duplicate Table
                  </button>
                  <button 
                    onClick={deleteNode}
                    className="flex-1 py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-[11px] font-bold rounded-lg transition-all"
                  >
                    Delete Table
                  </button>
                </div>
              </div>
            )}

            {/* 2. EDGE SELECTED */}
            {selectedEdge && !selectedNode && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
                  <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Relationship Details</span>
                  <span className="text-[9px] text-[#4A90D9] bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Edge</span>
                </div>

                {/* Connection description */}
                <div className="bg-[#050913]/60 border border-white/[0.05] p-3 rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between text-white/50 text-[10px]">
                    <span>Source (Parent)</span>
                    <span>Target (Child)</span>
                  </div>
                  <div className="flex items-center justify-between font-bold text-white font-mono">
                    <span className="text-yellow-400 truncate max-w-[100px]">{selectedEdge.source}</span>
                    <ArrowRightLeft size={12} className="text-[#4A90D9] mx-2" />
                    <span className="text-sky-400 truncate max-w-[100px]">{selectedEdge.target}</span>
                  </div>
                </div>

                {/* Relationship Type Selector (Cardinality) */}
                <div className="space-y-2">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Cardinality Notation</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { type: "one-to-one", label: "1 : 1 (One-to-One)" },
                      { type: "one-to-many", label: "1 : N (One-to-Many)" },
                      { type: "many-to-one", label: "N : 1 (Many-to-One)" },
                      { type: "many-to-many", label: "N : M (Many-to-Many)" }
                    ].map(card => {
                      const currentType = (selectedEdge.data?.relationshipType as string) || "one-to-many";
                      return (
                        <button
                          key={card.type}
                          onClick={() => handleRelationshipTypeChange(card.type)}
                          className={`py-2 px-1 text-[10px] font-semibold border rounded-lg transition-all ${
                            currentType === card.type
                              ? "bg-[#4A90D9]/15 border-[#4A90D9]/40 text-white shadow-inner"
                              : "bg-white/[0.01] border-white/[0.06] text-white/50 hover:text-white"
                          }`}
                        >
                          {card.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Column Mappings */}
                <div className="space-y-2">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide">Key Join Mapping</label>
                  
                  <div className="space-y-2 bg-[#040810]/40 border border-white/[0.04] p-3 rounded-xl">
                    {/* Source Column */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-white/65 font-mono block">Primary Key (Source)</span>
                      <select
                        value={(selectedEdge.data?.sourceColumn as string) || "id"}
                        onChange={e => updateEdgeData("sourceColumn", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white/80 outline-none"
                      >
                        {((nodes.find(n => n.id === selectedEdge.source)?.data.attributes as any[]) || []).map(a => (
                          <option key={a.name} value={a.name}>{a.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Target Column */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-white/65 font-mono block">Foreign Key (Target)</span>
                      <select
                        value={(selectedEdge.data?.targetColumn as string) || ""}
                        onChange={e => updateEdgeData("targetColumn", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-white/80 outline-none"
                      >
                        <option value="">Select target column...</option>
                        {((nodes.find(n => n.id === selectedEdge.target)?.data.attributes as any[]) || []).map(a => (
                          <option key={a.name} value={a.name}>{a.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Cascade constraints ON DELETE / ON UPDATE */}
                <div className="space-y-2 border-t border-white/[0.05] pt-3">
                  <label className="text-[11px] text-white/65 font-sans font-medium tracking-wide flex items-center gap-1.5">
                    <Info size={11} className="text-[#4A90D9]/80" />
                    Referential Integrity Constraints
                  </label>
                  
                  <div className="grid grid-cols-2 gap-2 bg-[#040810]/40 border border-white/[0.04] p-3 rounded-xl">
                    <div className="space-y-1">
                      <span className="text-[10px] text-white/45 font-sans uppercase block">ON DELETE</span>
                      <select
                        value={(selectedEdge.data?.onDelete as string) || "NO ACTION"}
                        onChange={e => updateEdgeData("onDelete", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-1.5 py-1 text-[11px] text-white/70 outline-none"
                      >
                        <option value="NO ACTION">NO ACTION</option>
                        <option value="CASCADE">CASCADE</option>
                        <option value="SET NULL">SET NULL</option>
                        <option value="RESTRICT">RESTRICT</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] text-white/45 font-sans uppercase block">ON UPDATE</span>
                      <select
                        value={(selectedEdge.data?.onUpdate as string) || "NO ACTION"}
                        onChange={e => updateEdgeData("onUpdate", e.target.value)}
                        className="w-full bg-[#050913] border border-white/[0.08] rounded-lg px-1.5 py-1 text-[11px] text-white/70 outline-none"
                      >
                        <option value="NO ACTION">NO ACTION</option>
                        <option value="CASCADE">CASCADE</option>
                        <option value="SET NULL">SET NULL</option>
                        <option value="RESTRICT">RESTRICT</option>
                      </select>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={deleteEdge}
                  className="w-full py-2 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-red-400 text-[11px] font-bold rounded-lg transition-all"
                >
                  Delete Relationship
                </button>
              </div>
            )}

            {/* 3. NOTHING SELECTED - SHOW SETTINGS */}
            {!selectedNode && !selectedEdge && (
              <div className="space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-center border-b border-white/[0.05] pb-2">
                  <span className="text-[11px] font-sans font-semibold tracking-wider text-white/65 uppercase [font-variant:all-small-caps]">Workspace Settings</span>
                  <Settings size={13} className="text-white/65" />
                </div>

                <div className="space-y-3 bg-[#050913]/30 border border-white/[0.04] p-3 rounded-xl">
                  {/* SQL Dialect */}
                  <div className="space-y-1.5">
                    <span className="text-[11px] text-white/65 font-sans font-medium tracking-wide block">SQL dialect mapper</span>
                    <div className="relative">
                      <select 
                        value={sqlDialect} 
                        onChange={e => setSqlDialect(e.target.value)}
                        className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50"
                      >
                        <option value="postgres">PostgreSQL</option>
                        <option value="mysql">MySQL Dialect</option>
                        <option value="sqlite">SQLite Dialect</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
                    </div>
                  </div>

                  {/* Auto Layout */}
                  <div className="flex items-center justify-between py-2 border-t border-white/[0.04] mt-2">
                    <span className="text-[11px] text-white/70 font-semibold tracking-wide">Instant Auto-Layout</span>
                    <button 
                      onClick={() => setAutoLayout(!autoLayout)}
                      className={`w-9 h-5 rounded-full transition-all relative border border-white/[0.06] shadow-inner ${
                        autoLayout ? "bg-[#4A90D9] border-[#4A90D9]/20" : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ease-out shadow-[0_1px_3px_rgba(0,0,0,0.4)] ${
                        autoLayout ? "left-[17px] bg-[#030712]" : "left-0.5 bg-white/60"
                      }`} />
                    </button>
                  </div>

                  {/* Show Grid */}
                  <div className="flex items-center justify-between py-2 border-t border-white/[0.04]">
                    <span className="text-[11px] text-white/70 font-semibold tracking-wide">Show Grid Patterns</span>
                    <button 
                      onClick={() => setShowGrid(!showGrid)}
                      className={`w-9 h-5 rounded-full transition-all relative border border-white/[0.06] shadow-inner ${
                        showGrid ? "bg-[#4A90D9] border-[#4A90D9]/20" : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all duration-300 ease-out shadow-[0_1px_3px_rgba(0,0,0,0.4)] ${
                        showGrid ? "left-[17px] bg-[#030712]" : "left-0.5 bg-white/60"
                      }`} />
                    </button>
                  </div>

                  {/* Node Opacity */}
                  <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-white/70 font-semibold tracking-wide">Node Opacity Slider</span>
                      <span className="text-[10px] text-[#C9C8C7] font-mono font-bold bg-[#4A90D9]/10 border border-[#4A90D9]/20 px-1.5 py-0.5 rounded">
                        {nodeOpacity}%
                      </span>
                    </div>
                    <input 
                      type="range" 
                      min="30" 
                      max="100" 
                      value={nodeOpacity} 
                      onChange={e => setNodeOpacity(parseInt(e.target.value))}
                      className="w-full accent-[#4A90D9] h-1 bg-white/10 rounded-lg cursor-pointer appearance-none outline-none" 
                    />
                  </div>

                  {/* Typography Font Face */}
                  <div className="space-y-1.5 border-t border-white/[0.04] pt-2.5">
                    <span className="text-[11px] text-white/65 font-sans font-medium tracking-wide block">Canvas Typography</span>
                    <div className="relative">
                      <select 
                        value={selectedFont} 
                        onChange={e => setSelectedFont(e.target.value)}
                        className="w-full bg-[#080E18] border border-white/[0.08] rounded-lg px-3 py-2 text-xs text-white outline-none appearance-none cursor-pointer focus:border-[#4A90D9]/50"
                      >
                        {FONT_OPTIONS.map(f => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-white/30 text-xs">▼</div>
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-white/35 leading-relaxed bg-[#050913]/10 border border-white/[0.02] p-3 rounded-xl flex gap-2">
                  <Info size={13} className="shrink-0 text-[#4A90D9]" />
                  <span>Double-click any schema entity node or single click any relationship line to inspect and configure attributes.</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SQL workspace has been moved to the left panel (SQLCodePanel) */}
        
      </div>
    </div>
  );
}
