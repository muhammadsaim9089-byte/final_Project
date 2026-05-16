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
