import { Schema, Entity } from './utils/schema_validator';
import { logger } from './utils/logger';

export interface SqlExportConfig {
    includeDropTables?: boolean;
    useAlterTable?: boolean;
}

export function generateTables(schema: Schema, dialect: 'postgres' | 'mysql' | 'sqlite', config: SqlExportConfig = {}): string {
    logger.logInfo('generateTables', `Starting SQL DDL export for ${dialect}`);
    let sql = `-- DesignDB Export DDL\n-- Dialect: ${dialect.toUpperCase()}\n-- Generated At: ${new Date().toISOString()}\n\n`;

    const sortedEntities = topologicalSort(schema);

    // Create schemas / groups first
    const groups = Array.from(new Set(
        sortedEntities
            .map(e => ((e as any).group as string || '').trim())
            .filter(Boolean)
    ));
    if (groups.length > 0 && dialect === 'postgres') {
        sql += `-- ==========================================\n-- SCHEMAS\n-- ==========================================\n`;
        for (const g of groups) {
            sql += `CREATE SCHEMA IF NOT EXISTS ${escapeName(g, dialect)};\n`;
        }
        sql += `\n`;
    }
    
    if (config.includeDropTables) {
        sql += `-- ==========================================\n-- DROP TABLES\n-- ==========================================\n`;
        for (let i = sortedEntities.length - 1; i >= 0; i--) {
            const ent = sortedEntities[i];
            const table = qualifyName(ent.name, (ent as any).group, dialect);
            sql += dialect === 'postgres' ? `DROP TABLE IF EXISTS ${table} CASCADE;\n` : `DROP TABLE IF EXISTS ${table};\n`;
        }
        sql += `\n`;
    }

    sql += `-- ==========================================\n-- CREATE TABLES\n-- ==========================================\n`;
    
    for (const entity of sortedEntities) {
        const desc = (entity as any).description || (entity as any).comment;
        const group = ((entity as any).group as string || '').trim();
        if (desc && dialect !== 'postgres' && dialect !== 'mysql') {
            // one line: a newline in the description would otherwise end the comment and run as SQL
            sql += `-- Comment: ${String(desc).replace(/\s*[\r\n]+\s*/g, ' ')}\n`;
        }

        sql += `CREATE TABLE ${qualifyName(entity.name, group, dialect)} (\n`;
        const colDefs: string[] = [];
        // a composite key is one table-level PRIMARY KEY (a, b) — repeating PRIMARY KEY on each column is an error
        const pkColumns = entity.attributes.filter(a => a.isPrimaryKey);
        const compositeKey = pkColumns.length > 1;
        for (const attr of entity.attributes) {
            const rawType = attr.dataType.toUpperCase();
            const isSerial = rawType === 'SERIAL' || rawType === 'BIGSERIAL';
            const name = escapeName(attr.name, dialect);
            let def = `    ${name} ${mapDataType(attr.dataType, dialect, (attr as any).size)}`;
            if (attr.isPrimaryKey && !compositeKey) {
                const useIdentity = (attr as any).autoIncrement || rawType.includes('INT') || (isSerial && dialect === 'sqlite');
                if (isSerial && dialect === 'postgres') {
                    def += ` PRIMARY KEY`;
                } else if (useIdentity && dialect === 'sqlite') {
                    // SQLite only auto-numbers an INTEGER PRIMARY KEY, and AUTOINCREMENT must follow PRIMARY KEY
                    def = `    ${name} INTEGER PRIMARY KEY AUTOINCREMENT`;
                } else {
                    def += useIdentity ? ` ${getAutoIncrementSyntax(dialect)} PRIMARY KEY` : ` PRIMARY KEY`;
                }
            } else if ((attr as any).autoIncrement && !isSerial && !attr.isPrimaryKey && dialect !== 'sqlite') {
                def += ` ${getAutoIncrementSyntax(dialect)}`;
            }
            if (!attr.isNullable && (!attr.isPrimaryKey || compositeKey)) def += ` NOT NULL`;
            if (attr.isUnique && !attr.isPrimaryKey) def += ` UNIQUE`;
            if (attr.defaultValue) def += ` DEFAULT ${sqlDefault(attr.defaultValue, dialect)}`;
            colDefs.push(def);
        }
        if (compositeKey) colDefs.push(`    PRIMARY KEY (${pkColumns.map(a => escapeName(a.name, dialect)).join(', ')})`);

        // Custom Constraints
        const customConstraints = (entity as any).constraints || [];
        for (const check of customConstraints) {
            if (check.name && check.expression) {
                colDefs.push(`    CONSTRAINT ${escapeName(check.name, dialect)} CHECK (${check.expression})`);
            }
        }

        if (!config.useAlterTable) {
            const fks = schema.relationships.filter(r => r.fromEntity === entity.name);
            for (const fk of fks) {
                const toEnt = schema.entities.find(e => e.name === fk.toEntity);
                const toGroup = toEnt ? ((toEnt as any).group as string || '') : '';
                colDefs.push(`    CONSTRAINT ${escapeName(`fk_${entity.name}_${fk.foreignKey}`, dialect)} FOREIGN KEY (${escapeName(fk.foreignKey, dialect)}) REFERENCES ${qualifyName(fk.toEntity, toGroup, dialect)}(${escapeName(fk.referencedKey, dialect)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`);
            }
        }
        
        let tableClose = `\n)`;
        if (dialect === 'mysql' && desc) {
            tableClose += ` COMMENT='${desc.replace(/'/g, "''")}'`;
        }
        sql += colDefs.join(',\n') + tableClose + ';\n\n';
    }

    // Postgres specific table comments
    if (dialect === 'postgres') {
        let hasComments = false;
        for (const entity of sortedEntities) {
            const desc = (entity as any).description || (entity as any).comment;
            const group = ((entity as any).group as string || '').trim();
            if (desc) {
                sql += `COMMENT ON TABLE ${qualifyName(entity.name, group, dialect)} IS '${desc.replace(/'/g, "''")}';\n`;
                hasComments = true;
            }
        }
        if (hasComments) sql += `\n`;
    }

    if (config.useAlterTable) {
        sql += `-- ==========================================\n-- FOREIGN KEYS\n-- ==========================================\n`;
        for (const rel of schema.relationships) {
            const fromEnt = schema.entities.find(e => e.name === rel.fromEntity);
            const toEnt = schema.entities.find(e => e.name === rel.toEntity);
            const fromGroup = fromEnt ? ((fromEnt as any).group as string || '') : '';
            const toGroup = toEnt ? ((toEnt as any).group as string || '') : '';
            sql += `ALTER TABLE ${qualifyName(rel.fromEntity, fromGroup, dialect)} ADD CONSTRAINT ${escapeName(`fk_${rel.fromEntity}_${rel.foreignKey}`, dialect)} FOREIGN KEY (${escapeName(rel.foreignKey, dialect)}) REFERENCES ${qualifyName(rel.toEntity, toGroup, dialect)}(${escapeName(rel.referencedKey, dialect)}) ON DELETE ${rel.onDelete} ON UPDATE ${rel.onUpdate};\n`;
        }
        sql += `\n`;
    }

    // Generate Custom Indexes
    const customIndexesFound = sortedEntities.some(e => (e as any).indexes && (e as any).indexes.length > 0);
    if (customIndexesFound) {
        sql += `-- ==========================================\n-- CUSTOM INDEXES\n-- ==========================================\n`;
        for (const entity of sortedEntities) {
            const idxs = (entity as any).indexes || [];
            const group = ((entity as any).group as string || '').trim();
            for (const idx of idxs) {
                if (idx.name && idx.columns && idx.columns.length > 0) {
                    const isUnique = idx.type === "UNIQUE" ? "UNIQUE " : "";
                    const cols = idx.columns.map((c: string) => escapeName(c, dialect)).join(', ');
                    let using = "";
                    if (dialect === 'postgres' && idx.type === 'HASH') using = " USING HASH";
                    else if (dialect === 'postgres' && idx.type === 'BTREE') using = " USING BTREE";
                    sql += `CREATE ${isUnique}INDEX ${escapeName(idx.name, dialect)} ON ${qualifyName(entity.name, group, dialect)}${using} (${cols});\n`;
                }
            }
        }
        sql += `\n`;
    }

    // Generate INDEXES for Foreign Key columns
    if (schema.relationships.length > 0) {
        sql += `-- ==========================================\n-- FOREIGN KEY INDEXES\n-- ==========================================\n`;
        for (const rel of schema.relationships) {
            const fromEnt = schema.entities.find(e => e.name === rel.fromEntity);
            const fromGroup = fromEnt ? ((fromEnt as any).group as string || '') : '';
            const indexName = `idx_${rel.fromEntity}_${rel.foreignKey}`;
            sql += `CREATE INDEX ${escapeName(indexName, dialect)} ON ${qualifyName(rel.fromEntity, fromGroup, dialect)} (${escapeName(rel.foreignKey, dialect)});\n`;
        }
        sql += `\n`;
    }

    // Generate INSERT INTO statements for Seed Data
    const entitiesWithSeed = sortedEntities.filter(e => (e as any).seedData && (e as any).seedData.length > 0);
    if (entitiesWithSeed.length > 0) {
        sql += `-- ==========================================\n-- SEED DATA\n-- ==========================================\n`;
        for (const entity of entitiesWithSeed) {
            const group = ((entity as any).group as string || '').trim();
            const tableName = qualifyName(entity.name, group, dialect);
            const seedRows = (entity as any).seedData as Record<string, any>[];
            for (const row of seedRows) {
                const cols = Object.keys(row).filter(c => row[c] !== undefined && row[c] !== '');
                if (cols.length === 0) continue;
                
                const escapedCols = cols.map(c => escapeName(c, dialect)).join(', ');
                const vals = cols.map(c => {
                    const val = row[c];
                    if (val === null || val === undefined) return 'NULL';
                    if (typeof val === 'number') return String(val);
                    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
                    return `'${String(val).replace(/'/g, "''")}'`;
                }).join(', ');
                
                sql += `INSERT INTO ${tableName} (${escapedCols}) VALUES (${vals});\n`;
            }
            sql += `\n`;
        }
    }

    return sql;
}

function topologicalSort(schema: Schema): Entity[] {
    const sorted: Entity[] = [];
    const visited = new Set<string>();
    const processing = new Set<string>();
    const entityMap = new Map(schema.entities.map(e => [e.name, e]));

    function visit(entityName: string) {
        if (processing.has(entityName)) return;
        if (visited.has(entityName)) return;
        processing.add(entityName);
        const dependsOn = schema.relationships.filter(r => r.fromEntity === entityName).map(r => r.toEntity);
        for (const dep of dependsOn) {
            if (entityMap.has(dep)) visit(dep);
        }
        processing.delete(entityName);
        visited.add(entityName);
        const ent = entityMap.get(entityName);
        if (ent) sorted.push(ent);
    }

    for (const entity of schema.entities) visit(entity.name);
    return sorted;
}

// Words PostgreSQL, MySQL or SQLite reserve that schemas commonly use as names (quoting one that only some dialects
// reserve is harmless).
const RESERVED = new Set([
    'add', 'all', 'alter', 'analyze', 'and', 'any', 'as', 'asc', 'between', 'both', 'by', 'case', 'cast', 'change', 'check',
    'collate', 'column', 'condition', 'constraint', 'create', 'cross', 'current_date', 'current_time', 'current_timestamp',
    'current_user', 'database', 'default', 'delete', 'desc', 'describe', 'distinct', 'div', 'do', 'drop', 'else', 'end',
    'except', 'exists', 'explain', 'false', 'fetch', 'for', 'foreign', 'from', 'full', 'grant', 'group', 'groups', 'having',
    'if', 'in', 'index', 'inner', 'insert', 'interval', 'intersect', 'into', 'is', 'join', 'key', 'keys', 'kill', 'lateral',
    'leading', 'left', 'like', 'limit', 'lock', 'match', 'mod', 'natural', 'not', 'null', 'offset', 'on', 'only', 'option',
    'or', 'order', 'outer', 'primary', 'range', 'rank', 'read', 'references', 'release', 'rename', 'replace', 'require',
    'returning', 'revoke', 'right', 'row', 'rows', 'schema', 'select', 'session_user', 'set', 'show', 'some', 'table', 'then',
    'to', 'trailing', 'trigger', 'true', 'union', 'unique', 'update', 'usage', 'user', 'using', 'values', 'when', 'where',
    'window', 'with', 'write',
]);

/** A plain, non-reserved name stays as it is; anything else is quoted, with quote characters inside it doubled. */
function escapeName(name: string, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toLowerCase())) return name;
    return dialect === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : `"${name.replace(/"/g, '""')}"`;
}

/**
 * A DEFAULT clause value. Numbers, booleans, NULL, quoted literals, CURRENT_* keywords and expressions are SQL
 * already; anything else is a text value and gets quoted (`DEFAULT 'pending'`, not `DEFAULT pending`).
 */
function sqlDefault(value: string, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    const v = String(value).trim();
    if (/^-?\d+(\.\d+)?$/.test(v) || /^(true|false|null)$/i.test(v) || /^'.*'$/s.test(v) || /^\(.*\)$/s.test(v)) return v;
    if (/^(current_timestamp|current_date|current_time|localtimestamp|localtime)$/i.test(v)) return v.toUpperCase();
    // a function call: SQLite only takes an expression default inside parentheses
    if (/^[A-Za-z_][\w.]*\s*\(.*\)$/s.test(v)) return dialect === 'sqlite' ? `(${v})` : v;
    return `'${v.replace(/'/g, "''")}'`;
}

function qualifyName(name: string, group: string | undefined, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    const g = (group || '').trim();
    if (g && dialect === 'postgres') {
        return `${escapeName(g, dialect)}.${escapeName(name, dialect)}`;
    }
    return escapeName(name, dialect);
}

function getAutoIncrementSyntax(dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    if (dialect === 'postgres') return 'GENERATED ALWAYS AS IDENTITY';
    if (dialect === 'mysql') return 'AUTO_INCREMENT';
    return dialect === 'sqlite' ? 'AUTOINCREMENT' : '';
}

function mapDataType(type: string, dialect: 'postgres' | 'mysql' | 'sqlite', size?: string | null): string {
    const t = type.toUpperCase();
    const sizeSuffix = size && /^\d+(\s*,\s*\d+)?$/.test(String(size).trim()) ? `(${String(size).trim()})` : '';

    if (dialect === 'postgres' && t === 'DATETIME') return 'TIMESTAMP';
    if (dialect === 'sqlite') {
        if (t.includes('VARCHAR') || t === 'CHAR') return 'TEXT';
        if (t === 'BOOLEAN') return 'INTEGER';
    }

    if ((t === 'VARCHAR' || t === 'CHAR' || t === 'DECIMAL' || t === 'NUMERIC') && sizeSuffix) {
        return `${t}${sizeSuffix}`;
    }
    if (t.startsWith('VARCHAR') || t.startsWith('CHAR') || t.startsWith('DECIMAL')) {
        return t;
    }
    return t;
}
