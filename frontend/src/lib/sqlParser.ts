/**
 * Client-side SQL DDL parser for DesignDB.
 * Parses standard SQL CREATE TABLE statements (with columns, types, primary keys, and foreign keys).
 */

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
  fromEntity: string; // The child table (has the foreign key)
  toEntity: string;   // The parent table (has the primary key)
  foreignKey: string;
  referencedKey?: string; // The primary key column in the parent table
  type: string;       // e.g. 'one-to-many'
}

export interface ParsedSchema {
  entities: ParsedEntity[];
  relationships: ParsedRelationship[];
}

export function parseSqlDdl(sql: string): ParsedSchema {
  const schema: ParsedSchema = {
    entities: [],
    relationships: []
  };

  // Normalize SQL: remove comments, clean up spacing
  const cleanSql = sql
    .replace(/--.*$/gm, '') // remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove block comments
    .replace(/\s+/g, ' ') // collapse whitespaces
    .trim();

  // Split by CREATE TABLE statements
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+|"\w+")\s*\((.*?)\)(?=\s*(?:CREATE|ALTER|INSERT|DROP|;|$))/gi;
  let match;

  while ((match = createTableRegex.exec(cleanSql)) !== null) {
    const tableName = match[1].replace(/"/g, '').trim();
    const columnsPart = match[2].trim();

    const entity: ParsedEntity = {
      name: tableName,
      attributes: []
    };

    // Split columnsPart by commas, but ignore commas inside parentheses (e.g. DECIMAL(10, 2))
    const lines: string[] = [];
    let currentLine = "";
    let parenCount = 0;

    for (let i = 0; i < columnsPart.length; i++) {
      const char = columnsPart[i];
      if (char === '(') parenCount++;
      if (char === ')') parenCount--;

      if (char === ',' && parenCount === 0) {
        lines.push(currentLine.trim());
        currentLine = "";
      } else {
        currentLine += char;
      }
    }
    if (currentLine.trim()) {
      lines.push(currentLine.trim());
    }

    const tableConstraints: string[] = [];

    // Parse column definitions and table-level constraints
    for (const line of lines) {
      const upperLine = line.toUpperCase().trim();

      // Check for table level PRIMARY KEY constraint, e.g., PRIMARY KEY (id) or CONSTRAINT pk_name PRIMARY KEY (col1, col2)
      if (upperLine.startsWith('PRIMARY KEY') || upperLine.includes('PRIMARY KEY')) {
        const pkMatch = line.match(/PRIMARY\s+KEY\s*\((.*?)\)/i);
        if (pkMatch) {
          const pkCols = pkMatch[1].split(',').map(c => c.replace(/"/g, '').trim());
          tableConstraints.push(...pkCols.map(c => `PK:${c}`));
        }
        continue;
      }

      // Check for table level FOREIGN KEY constraint, e.g., FOREIGN KEY (user_id) REFERENCES users(id)
      if (upperLine.startsWith('FOREIGN KEY') || upperLine.includes('FOREIGN KEY')) {
        const fkMatch = line.match(/FOREIGN\s+KEY\s*\((.*?)\)\s*REFERENCES\s+(\w+|"\w+")\s*\((.*?)\)/i);
        if (fkMatch) {
          const fkCol = fkMatch[1].replace(/"/g, '').trim();
          const refTable = fkMatch[2].replace(/"/g, '').trim();
          const refCol = fkMatch[3].replace(/"/g, '').trim();
          schema.relationships.push({
            fromEntity: tableName,
            toEntity: refTable,
            foreignKey: fkCol,
            referencedKey: refCol,
            type: 'one-to-many'
          });
          tableConstraints.push(`FK:${fkCol}`);
        }
        continue;
      }

      // Skip constraint naming prefixes (e.g. CONSTRAINT fk_users)
      if (upperLine.startsWith('CONSTRAINT')) {
        // Try parsing inline table constraints that might be after the naming
        const constraintMatch = line.match(/CONSTRAINT\s+\w+\s+(FOREIGN\s+KEY|PRIMARY\s+KEY)[\s\S]+/i);
        if (constraintMatch) {
          // If we match foreign key references inside CONSTRAINT
          const fkMatch = line.match(/FOREIGN\s+KEY\s*\((.*?)\)\s*REFERENCES\s+(\w+|"\w+")\s*\((.*?)\)/i);
          if (fkMatch) {
            const fkCol = fkMatch[1].replace(/"/g, '').trim();
            const refTable = fkMatch[2].replace(/"/g, '').trim();
            const refCol = fkMatch[3].replace(/"/g, '').trim();
            schema.relationships.push({
              fromEntity: tableName,
              toEntity: refTable,
              foreignKey: fkCol,
              referencedKey: refCol,
              type: 'one-to-many'
            });
            tableConstraints.push(`FK:${fkCol}`);
          }
          const pkMatch = line.match(/PRIMARY\s+KEY\s*\((.*?)\)/i);
          if (pkMatch) {
            const pkCols = pkMatch[1].split(',').map(c => c.replace(/"/g, '').trim());
            tableConstraints.push(...pkCols.map(c => `PK:${c}`));
          }
        }
        continue;
      }

      // Parse standard column definition: name type [constraints]
      const tokens = line.split(/\s+/);
      if (tokens.length < 2) continue;

      const colName = tokens[0].replace(/"/g, '').trim();
      let colType = tokens[1].trim();

      // Handle types with parameters (e.g. VARCHAR(255))
      if (colType.includes('(')) {
        let fullType = colType;
        let tIdx = 2;
        while (!fullType.includes(')') && tIdx < tokens.length) {
          fullType += " " + tokens[tIdx];
          tIdx++;
        }
        colType = fullType;
      }

      const isPk = upperLine.includes('PRIMARY KEY');
      const isFk = upperLine.includes('REFERENCES');

      if (isFk) {
        const refMatch = line.match(/REFERENCES\s+(\w+|"\w+")\s*\((.*?)\)/i);
        if (refMatch) {
          const refTable = refMatch[1].replace(/"/g, '').trim();
          const refCol = refMatch[2].replace(/"/g, '').trim();
          schema.relationships.push({
            fromEntity: tableName,
            toEntity: refTable,
            foreignKey: colName,
            referencedKey: refCol,
            type: 'one-to-many'
          });
        }
      }

      entity.attributes.push({
        name: colName,
        dataType: colType.toLowerCase(),
        isPrimaryKey: isPk,
        isForeignKey: isFk
      });
    }

    // Apply table-level constraints to attributes
    for (const constraint of tableConstraints) {
      const [type, col] = constraint.split(':');
      const attr = entity.attributes.find(a => a.name === col);
      if (attr) {
        if (type === 'PK') attr.isPrimaryKey = true;
        if (type === 'FK') attr.isForeignKey = true;
      }
    }

    schema.entities.push(entity);
  }

  // Parse standalone ALTER TABLE ADD CONSTRAINT statements
  const alterTableRegex = /ALTER\s+TABLE\s+(\w+|"\w+")\s+ADD\s+(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\((.*?)\)\s*REFERENCES\s+(\w+|"\w+")\s*\((.*?)\)/gi;
  while ((match = alterTableRegex.exec(cleanSql)) !== null) {
    const fromTable = match[1].replace(/"/g, '').trim();
    const fkCol = match[2].replace(/"/g, '').trim();
    const toTable = match[3].replace(/"/g, '').trim();
    const refCol = match[4].replace(/"/g, '').trim();

    schema.relationships.push({
      fromEntity: fromTable,
      toEntity: toTable,
      foreignKey: fkCol,
      referencedKey: refCol,
      type: 'one-to-many'
    });

    // Mark as foreign key in the corresponding entity attribute
    const entity = schema.entities.find(e => e.name === fromTable);
    if (entity) {
      const attr = entity.attributes.find(a => a.name === fkCol);
      if (attr) {
        attr.isForeignKey = true;
      }
    }
  }

  return schema;
}
