import type { Node, Edge } from "@xyflow/react";

export interface ParsedAttribute {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface ParsedEntity {
  name: string;
  attributes: ParsedAttribute[];
}

export interface ParsedRelationship {
  fromEntity: string; // Child table (holding foreign key)
  toEntity: string;   // Parent table (holding primary key)
  foreignKey: string;
  referencedKey: string;
  type: "many-to-one" | "one-to-one" | "one-to-many" | "many-to-many";
}

export interface ParsedSchema {
  entities: ParsedEntity[];
  relationships: ParsedRelationship[];
}

/**
 * Converts React Flow nodes & edges into a DBML string.
 */
export function schemaToDbml(nodes: Node[], edges: Edge[]): string {
  let dbml = "";

  // 1. Convert Table nodes
  const tableNodes = nodes.filter((n) => n.type === "tableMode");
  tableNodes.forEach((node) => {
    const tableName = node.data.label as string;
    dbml += `Table ${tableName} {\n`;

    const attributes = (node.data.attributes as any[]) || [];
    attributes.forEach((attr) => {
      let line = `  ${attr.name} ${attr.type || "varchar(255)"}`;
      
      const settings: string[] = [];
      if (attr.isPk) {
        settings.push("primary key");
      }
      if (attr.unique) {
        settings.push("unique");
      }
      if (attr.defaultValue) {
        settings.push(`default: \`${attr.defaultValue}\``);
      }

      if (settings.length > 0) {
        line += ` [${settings.join(", ")}]`;
      }
      dbml += line + "\n";
    });
    dbml += "}\n\n";
  });

  // 2. Convert Edges (Relationships)
  edges.forEach((edge) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!sourceNode || !targetNode) return;

    const parentTable = sourceNode.data.label as string;
    const childTable = targetNode.data.label as string;
    const parentCol = (edge.data?.sourceColumn as string) || (edge.data?.sourceField as string) || "id";
    const childCol = (edge.data?.targetColumn as string) || (edge.data?.targetField as string) || "";
    
    const relType = edge.data?.relationshipType || "many-to-one";
    let sign = ">";
    if (relType === "one-to-one") sign = "-";
    if (relType === "one-to-many") sign = "<";
    if (relType === "many-to-many") sign = "<>";

    dbml += `Ref: ${childTable}.${childCol} ${sign} ${parentTable}.${parentCol}\n`;
  });

  return dbml;
}

/**
 * Parses DBML text back into ParsedSchema (entities + relationships).
 */
export function dbmlToSchema(dbmlText: string): ParsedSchema {
  const schema: ParsedSchema = {
    entities: [],
    relationships: [],
  };

  const cleanDbml = dbmlText
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();

  const tableRegex = /Table\s+(?:[\w"]+\.)?([\w"]+)(?:\s+as\s+\w+)?\s*{([\s\S]*?)}/gi;
  let match;

  while ((match = tableRegex.exec(cleanDbml)) !== null) {
    const tableName = match[1].replace(/"/g, "").trim();
    const columnsBody = match[2].trim();

    const entity: ParsedEntity = {
      name: tableName,
      attributes: [],
    };

    const lines = columnsBody.split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const bracketIndex = trimmed.indexOf("[");
      let colDef = trimmed;
      let settingsStr = "";
      if (bracketIndex !== -1) {
        colDef = trimmed.substring(0, bracketIndex).trim();
        settingsStr = trimmed.substring(bracketIndex + 1, trimmed.length - 1).trim();
      }

      const tokens = colDef.split(/\s+/);
      if (tokens.length < 1) return;

      const colName = tokens[0].replace(/"/g, "").trim();
      const colType = tokens.slice(1).join(" ").trim() || "varchar(255)";

      let isPk = false;
      const lowerSettings = settingsStr.toLowerCase();
      if (lowerSettings.includes("primary key") || lowerSettings.includes("pk")) {
        isPk = true;
      }

      const inlineRefMatch = settingsStr.match(/ref:\s*([><\-\+]+)\s*([\w"\.]+)/i);
      if (inlineRefMatch) {
        const sign = inlineRefMatch[1].trim();
        const targetRef = inlineRefMatch[2].replace(/"/g, "").trim();
        
        const targetParts = targetRef.split(".");
        if (targetParts.length >= 2) {
          const parentTable = targetParts[targetParts.length - 2];
          const parentCol = targetParts[targetParts.length - 1];

          let relType: any = "many-to-one";
          if (sign === "-") relType = "one-to-one";
          if (sign === "<") relType = "one-to-many";
          if (sign === "<>") relType = "many-to-many";

          schema.relationships.push({
            fromEntity: tableName,
            toEntity: parentTable,
            foreignKey: colName,
            referencedKey: parentCol,
            type: relType,
          });
        }
      }

      entity.attributes.push({
        name: colName,
        dataType: colType,
        isPrimaryKey: isPk,
        isForeignKey: !!inlineRefMatch,
      });
    });

    schema.entities.push(entity);
  }

  const refLineRegex = /(?:Ref\s*\w*\s*:\s*|Ref\s*{?\s*)([\w"\.]+)\s*([><\-\+]+)\s*([\w"\.]+)/gi;
  let refMatch;
  while ((refMatch = refLineRegex.exec(cleanDbml)) !== null) {
    const leftSide = refMatch[1].replace(/"/g, "").trim();
    const sign = refMatch[2].trim();
    const rightSide = refMatch[3].replace(/"/g, "").trim();

    const leftParts = leftSide.split(".");
    const rightParts = rightSide.split(".");

    if (leftParts.length >= 2 && rightParts.length >= 2) {
      const fromTable = leftParts[leftParts.length - 2];
      const fromCol = leftParts[leftParts.length - 1];
      const toTable = rightParts[rightParts.length - 2];
      const toCol = rightParts[rightParts.length - 1];

      let relType: any = "many-to-one";
      if (sign === "-") relType = "one-to-one";
      if (sign === "<") relType = "one-to-many";
      if (sign === "<>") relType = "many-to-many";

      const sourceEntity = schema.entities.find(e => e.name === fromTable);
      if (sourceEntity) {
        const attr = sourceEntity.attributes.find(a => a.name === fromCol);
        if (attr) {
          attr.isForeignKey = true;
        }
      }

      schema.relationships.push({
        fromEntity: fromTable,
        toEntity: toTable,
        foreignKey: fromCol,
        referencedKey: toCol,
        type: relType,
      });
    }
  }

  return schema;
}
