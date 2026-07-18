import type { Node, Edge } from '@xyflow/react';

export interface ValidationError {
  column?: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, ValidationError[]>;
  warnings: Record<string, ValidationError[]>;
  globalErrors: string[];
}

const RESERVED_KEYWORDS = new Set([
  'select', 'from', 'where', 'insert', 'update', 'delete', 'create', 'table',
  'drop', 'alter', 'index', 'constraint', 'primary', 'key', 'foreign', 'references',
  'user', 'order', 'group', 'join', 'having', 'limit', 'offset', 'check', 'unique',
  'into', 'values', 'set', 'add', 'column', 'default', 'null', 'not', 'exists', 'if'
]);

export function validateCanvasSchema(nodes: Node[], edges: Edge[]): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: {},
    warnings: {},
    globalErrors: []
  };

  const addError = (nodeId: string, message: string, column?: string) => {
    if (!result.errors[nodeId]) result.errors[nodeId] = [];
    result.errors[nodeId].push({ message, column, severity: 'error' });
    result.isValid = false;
  };

  const addWarning = (nodeId: string, message: string, column?: string) => {
    if (!result.warnings[nodeId]) result.warnings[nodeId] = [];
    result.warnings[nodeId].push({ message, column, severity: 'warning' });
  };

  const nodeMap = new Map<string, Node>();
  const tableNameMap = new Map<string, Node>();

  // Populate maps for quick lookup
  for (const node of nodes) {
    nodeMap.set(node.id, node);
    const label = node.data?.label as string;
    if (label) {
      tableNameMap.set(label.toLowerCase(), node);
    }
  }

  // 1. Validate Nodes (Tables and Columns)
  for (const node of nodes) {
    const label = node.data?.label as string;
    if (!label) {
      addError(node.id, 'Table name is missing');
      continue;
    }

    // Reserved table keyword
    if (RESERVED_KEYWORDS.has(label.toLowerCase())) {
      addWarning(node.id, `Table name '${label}' is a reserved SQL keyword. It must be quoted in queries.`, 'header');
    }

    const attributes = (node.data?.attributes as any[]) || [];

    // Missing primary key
    const hasPk = attributes.some(attr => attr.isPk);
    if (!hasPk && attributes.length > 0) {
      addError(node.id, `Table '${label}' has no primary key defined`);
    }

    // Duplicate column names
    const colNames = new Set<string>();
    const dupes = new Set<string>();
    for (const attr of attributes) {
      const colLower = attr.name.toLowerCase();
      if (colNames.has(colLower)) {
        dupes.add(attr.name);
      }
      colNames.add(colLower);

      // Reserved column keyword
      if (RESERVED_KEYWORDS.has(colLower)) {
        addWarning(node.id, `Column name '${attr.name}' is a reserved SQL keyword.`, attr.name);
      }
    }

    for (const dupe of dupes) {
      addError(node.id, `Table has duplicate column name: '${dupe}'`, dupe);
    }
  }

  // 2. Validate Relationships (Edges)
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source);
    const targetNode = nodeMap.get(edge.target);

    // Check relationship target/source existence
    if (!sourceNode || !targetNode) {
      result.globalErrors.push(`Relationship references missing table(s): Source [${edge.source}], Target [${edge.target}]`);
      result.isValid = false;
      continue;
    }

    const sourceLabel = sourceNode.data?.label as string;
    const targetLabel = targetNode.data?.label as string;

    const sourceColumn = edge.data?.sourceColumn as string;
    const targetColumn = edge.data?.targetColumn as string;

    if (!targetColumn) {
      // If column mappings are not defined yet, we skip field-level checks
      continue;
    }

    const sourceAttrs = (sourceNode.data?.attributes as any[]) || [];
    const targetAttrs = (targetNode.data?.attributes as any[]) || [];

    // Find FK column in target (child) table
    const fkAttr = targetAttrs.find(a => a.name === targetColumn);
    if (!fkAttr) {
      addError(edge.target, `Foreign key column '${targetColumn}' does not exist in table '${targetLabel}'`, targetColumn);
      continue;
    }

    // Find PK column in source (parent) table
    const refKey = sourceColumn || 'id';
    const pkAttr = sourceAttrs.find(a => a.name === refKey);
    if (!pkAttr) {
      addError(edge.source, `Referenced primary key column '${refKey}' does not exist in parent table '${sourceLabel}'`, refKey);
      continue;
    }

    // Check if referenced column is actually a PK
    if (!pkAttr.isPk) {
      addWarning(edge.source, `Referenced column '${refKey}' is not marked as a Primary Key in table '${sourceLabel}'`, refKey);
    }

    // Datatype consistency check
    const pkType = (pkAttr.type || '').toLowerCase();
    const fkType = (fkAttr.type || '').toLowerCase();

    const normalizeType = (t: string) => {
      if (t.includes('int')) return 'integer';
      if (t.includes('char') || t.includes('text')) return 'text';
      if (t.includes('float') || t.includes('double') || t.includes('decimal') || t.includes('numeric')) return 'numeric';
      return t;
    };

    if (normalizeType(pkType) !== normalizeType(fkType)) {
      addWarning(edge.target, `Type mismatch: Foreign key '${targetColumn}' (${fkType}) references PK '${refKey}' (${pkType}) in table '${sourceLabel}'`, targetColumn);
    }
  }

  // 3. Circular Dependency Check (DFS-based)
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    // Child depends on Parent (target depends on source)
    if (adj.has(edge.target) && adj.has(edge.source)) {
      adj.get(edge.target)!.push(edge.source);
    }
  }

  const visited = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=visited
  const path: string[] = [];

  const dfs = (u: string) => {
    visited.set(u, 1);
    path.push(u);

    for (const v of adj.get(u) || []) {
      if (visited.get(v) === 1) {
        // Circular dependency cycle found!
        const cycleIdx = path.indexOf(v);
        if (cycleIdx !== -1) {
          const cycleTables = path.slice(cycleIdx).map(id => nodeMap.get(id)?.data?.label as string).filter(Boolean);
          const cycleStr = [...cycleTables, cycleTables[0]].join(' -> ');
          // Flag error on the cycle nodes
          path.slice(cycleIdx).forEach(nodeId => {
            addError(nodeId, `Circular dependency detected: ${cycleStr}`);
          });
        }
      } else if (!visited.get(v)) {
        dfs(v);
      }
    }

    path.pop();
    visited.set(u, 2);
  };

  for (const node of nodes) {
    if (!visited.get(node.id)) {
      dfs(node.id);
    }
  }

  return result;
}
