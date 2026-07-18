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
    
    if (config.includeDropTables) {
        sql += `-- ==========================================\n-- DROP TABLES\n-- ==========================================\n`;
        for (let i = sortedEntities.length - 1; i >= 0; i--) {
            const table = escapeName(sortedEntities[i].name, dialect);
            sql += dialect === 'postgres' ? `DROP TABLE IF EXISTS ${table} CASCADE;\n` : `DROP TABLE IF EXISTS ${table};\n`;
        }
        sql += `\n`;
    }

    sql += `-- ==========================================\n-- CREATE TABLES\n-- ==========================================\n`;
    
    for (const entity of sortedEntities) {
        sql += `CREATE TABLE ${escapeName(entity.name, dialect)} (\n`;
        const colDefs: string[] = [];
        for (const attr of entity.attributes) {
            let def = `    ${escapeName(attr.name, dialect)} ${mapDataType(attr.dataType, dialect)}`;
            if (attr.isPrimaryKey) {
                def += attr.dataType.toUpperCase().includes('INT') ? ` ${getAutoIncrementSyntax(dialect)} PRIMARY KEY` : ` PRIMARY KEY`;
            }
            if (!attr.isNullable && !attr.isPrimaryKey) def += ` NOT NULL`;
            if (attr.isUnique && !attr.isPrimaryKey) def += ` UNIQUE`;
            if (attr.defaultValue) def += ` DEFAULT ${attr.defaultValue}`;
            colDefs.push(def);
        }

        if (!config.useAlterTable) {
            const fks = schema.relationships.filter(r => r.fromEntity === entity.name);
            for (const fk of fks) {
                colDefs.push(`    CONSTRAINT fk_${entity.name}_${fk.foreignKey} FOREIGN KEY (${escapeName(fk.foreignKey, dialect)}) REFERENCES ${escapeName(fk.toEntity, dialect)}(${escapeName(fk.referencedKey, dialect)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`);
            }
        }
        sql += colDefs.join(',\n') + '\n);\n\n';
    }

    if (config.useAlterTable) {
        sql += `-- ==========================================\n-- FOREIGN KEYS\n-- ==========================================\n`;
        for (const rel of schema.relationships) {
            sql += `ALTER TABLE ${escapeName(rel.fromEntity, dialect)} ADD CONSTRAINT fk_${rel.fromEntity}_${rel.foreignKey} FOREIGN KEY (${escapeName(rel.foreignKey, dialect)}) REFERENCES ${escapeName(rel.toEntity, dialect)}(${escapeName(rel.referencedKey, dialect)}) ON DELETE ${rel.onDelete} ON UPDATE ${rel.onUpdate};\n`;
        }
        sql += `\n`;
    }

    // Generate INDEXES for Foreign Key columns
    if (schema.relationships.length > 0) {
        sql += `-- ==========================================\n-- INDEXES\n-- ==========================================\n`;
        for (const rel of schema.relationships) {
            const indexName = `idx_${rel.fromEntity}_${rel.foreignKey}`;
            sql += `CREATE INDEX ${escapeName(indexName, dialect)} ON ${escapeName(rel.fromEntity, dialect)} (${escapeName(rel.foreignKey, dialect)});\n`;
        }
        sql += `\n`;
    }

    // Generate INSERT INTO statements for Seed Data
    const entitiesWithSeed = sortedEntities.filter(e => (e as any).seedData && (e as any).seedData.length > 0);
    if (entitiesWithSeed.length > 0) {
        sql += `-- ==========================================\n-- SEED DATA\n-- ==========================================\n`;
        for (const entity of entitiesWithSeed) {
            const tableName = escapeName(entity.name, dialect);
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
                    // Otherwise string / date, escape single quotes
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

function escapeName(name: string, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    const reserved = ['user', 'order', 'group', 'select', 'where', 'from', 'table'];
    const isReserved = reserved.includes(name.toLowerCase());
    if (!isReserved) return name;
    return dialect === 'mysql' ? `\`${name}\`` : `"${name}"`;
}

function getAutoIncrementSyntax(dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    if (dialect === 'postgres') return 'GENERATED ALWAYS AS IDENTITY';
    if (dialect === 'mysql') return 'AUTO_INCREMENT';
    return dialect === 'sqlite' ? 'AUTOINCREMENT' : '';
}

function mapDataType(type: string, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
    const t = type.toUpperCase();
    if (dialect === 'postgres' && t === 'DATETIME') return 'TIMESTAMP';
    if (dialect === 'sqlite') {
        if (t.includes('VARCHAR')) return 'TEXT';
        if (t === 'BOOLEAN') return 'INTEGER';
    }
    return t;
}
