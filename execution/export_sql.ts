import { Schema, Entity } from './utils/schema_validator';
import { logger } from './utils/logger';

/** Map of  "tableName.columnName"  →  CHECK expression (raw SQL fragment).
 *  Example: { 'users.role': `role IN ('admin','designer','viewer','editor')` } */
export type CheckConstraints = Record<string, string>;

export interface SqlExportConfig {
    includeDropTables?: boolean;
    useAlterTable?: boolean;      // For cyclic FK scenarios
    checkConstraints?: CheckConstraints; // Domain validation rules
    createIndexes?: boolean;      // AUTO-index every FK column
}

export function generateTables(
    schema: Schema,
    dialect: 'postgres' | 'mysql' | 'sqlite',
    config: SqlExportConfig = {}
): string {
    logger.logInfo('generateTables', `Starting SQL DDL export for ${dialect}`);
    let sql = `-- DesignDB Export DDL\n-- Dialect: ${dialect.toUpperCase()}\n-- Generated At: ${new Date().toISOString()}\n\n`;

    const sortedEntities = topologicalSort(schema);
    
    // 1. DROP TABLES
    if (config.includeDropTables) {
        sql += `-- ==========================================\n-- DROP TABLES\n-- ==========================================\n`;
        // Drop in reverse dependency order
        for (let i = sortedEntities.length - 1; i >= 0; i--) {
            const table = escapeName(sortedEntities[i].name, dialect);
            if (dialect === 'postgres') {
                sql += `DROP TABLE IF EXISTS ${table} CASCADE;\n`;
            } else {
                sql += `DROP TABLE IF EXISTS ${table};\n`;
            }
        }
        sql += `\n`;
    }

    sql += `-- ==========================================\n-- CREATE TABLES\n-- ==========================================\n`;
    
    // 2. CREATE TABLES
    for (const entity of sortedEntities) {
        sql += `CREATE TABLE ${escapeName(entity.name, dialect)} (\n`;
        
        const colDefs: string[] = [];
        
        for (const attr of entity.attributes) {
            let def = `    ${escapeName(attr.name, dialect)} ${mapDataType(attr.dataType, dialect)}`;
            
            if (attr.isPrimaryKey) {
                if (attr.dataType.toUpperCase().includes('INT')) {
                    def += ` ${getAutoIncrementSyntax(dialect)} PRIMARY KEY`;
                } else {
                    def += ` PRIMARY KEY`;
                }
            }
            if (!attr.isNullable && !attr.isPrimaryKey) def += ` NOT NULL`;
            if (attr.isUnique && !attr.isPrimaryKey) def += ` UNIQUE`;
            if (attr.defaultValue) def += ` DEFAULT ${attr.defaultValue}`;
            
            colDefs.push(def);
        }

        // Add Foreign Keys inline (when not using ALTER TABLE mode)
        if (!config.useAlterTable) {
            const fks = schema.relationships.filter(r => r.fromEntity === entity.name);
            for (const fk of fks) {
                colDefs.push(
                    `    CONSTRAINT fk_${entity.name}_${fk.foreignKey}` +
                    ` FOREIGN KEY (${escapeName(fk.foreignKey, dialect)})` +
                    ` REFERENCES ${escapeName(fk.toEntity, dialect)}(${escapeName(fk.referencedKey, dialect)})` +
                    ` ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
                );
            }
        }

        // Add CHECK constraints for this table
        if (config.checkConstraints) {
            for (const [key, expr] of Object.entries(config.checkConstraints)) {
                const [tbl, col] = key.split('.');
                if (tbl === entity.name) {
                    const constraintName = `chk_${entity.name}_${col}`;
                    colDefs.push(`    CONSTRAINT ${constraintName} CHECK (${expr})`);
                }
            }
        }

        sql += colDefs.join(',\n') + '\n);\n\n';
    }

    // 3. ALTER TABLES (for cyclic FK scenarios)
    if (config.useAlterTable) {
        sql += `-- ==========================================\n-- FOREIGN KEYS (ALTER TABLE)\n-- ==========================================\n`;
        for (const rel of schema.relationships) {
            sql +=
                `ALTER TABLE ${escapeName(rel.fromEntity, dialect)}` +
                ` ADD CONSTRAINT fk_${rel.fromEntity}_${rel.foreignKey}` +
                ` FOREIGN KEY (${escapeName(rel.foreignKey, dialect)})` +
                ` REFERENCES ${escapeName(rel.toEntity, dialect)}(${escapeName(rel.referencedKey, dialect)})` +
                ` ON DELETE ${rel.onDelete} ON UPDATE ${rel.onUpdate};\n`;
        }
        sql += '\n';
    }

    // 4. CREATE INDEXES on every FK column (improves JOIN performance)
    if (config.createIndexes) {
        sql += `-- ==========================================\n-- INDEXES (FK columns)\n-- ==========================================\n`;
        const seen = new Set<string>();
        for (const rel of schema.relationships) {
            const key = `${rel.fromEntity}.${rel.foreignKey}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const idxName  = `idx_${rel.fromEntity}_${rel.foreignKey}`;
            const tblName  = escapeName(rel.fromEntity, dialect);
            const colName  = escapeName(rel.foreignKey, dialect);
            sql += `CREATE INDEX IF NOT EXISTS ${idxName} ON ${tblName} (${colName});\n`;
        }
        sql += '\n';
    }

    logger.logInfo('generateTables', 'SQL export generated successfully.');
    return sql;
}

// Helper: Topological Sort for Foreign Keys
function topologicalSort(schema: Schema): Entity[] {
    const sorted: Entity[] = [];
    const visited = new Set<string>();
    const processing = new Set<string>();
    
    // Quick Map for entities
    const entityMap = new Map(schema.entities.map(e => [e.name, e]));

    // Recursive helper
    function visit(entityName: string) {
        if (processing.has(entityName)) {
            logger.logWarning('export_sql:topoSort', `Cyclic dependency detected at ${entityName}. Output may crash without useAlterTable.`);
            return;
        }
        if (visited.has(entityName)) return;

        processing.add(entityName);
        
        // Find entities this entity depends on
        const dependsOn = schema.relationships
           .filter(r => r.fromEntity === entityName)
           .map(r => r.toEntity);
           
        for (const dep of dependsOn) {
            if (entityMap.has(dep)) {
                visit(dep);
            }
        }

        processing.delete(entityName);
        visited.add(entityName);
        const ent = entityMap.get(entityName);
        if (ent) sorted.push(ent);
    }

    for (const entity of schema.entities) {
        visit(entity.name);
    }

    return sorted;
}

// Helper: Escape SQL reserved keywords
function escapeName(name: string, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    const reserved = [
        'user','users','order','orders','group','select','where','from','table',
        'index','key','rank','values','schema','column','trigger','view','check'
    ];
    const isReserved = reserved.includes(name.toLowerCase());
    if (!isReserved) return name;
    if (dialect === 'mysql') return `\`${name}\``;
    return `"${name}"`; // Postgres & SQLite
}

// Helper: Auto-increment mapping
function getAutoIncrementSyntax(dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    if (dialect === 'postgres') return 'GENERATED ALWAYS AS IDENTITY'; // OR use SERIAL
    if (dialect === 'mysql') return 'AUTO_INCREMENT';
    if (dialect === 'sqlite') return 'AUTOINCREMENT';
    return '';
}

// Helper: Mapping Data Types
function mapDataType(type: string, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    const t = type.toUpperCase();
    if (dialect === 'postgres') {
        if (t === 'DATETIME') return 'TIMESTAMP';
    }
    if (dialect === 'sqlite') {
        if (t.includes('VARCHAR')) return 'TEXT';
        if (t === 'BOOLEAN') return 'INTEGER'; // SQLite uses 0/1 integers for booleans
    }
    return t;
}
