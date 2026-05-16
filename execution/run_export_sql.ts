/**
 * run_export_sql.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * M4: Generates the full DDL schema for the DesignDB application database.
 *
 * Outputs:
 *   data/schema_mysql.sql    — MySQL dialect (primary)
 *   data/schema_postgres.sql — PostgreSQL dialect
 *   data/schema_sqlite.sql   — SQLite dialect
 *
 * Includes:
 *   - CREATE TABLE with PK, FK, NOT NULL, UNIQUE
 *   - CHECK constraints for domain validation
 *   - CREATE INDEX on all FK columns
 *   - DROP TABLE IF EXISTS (safe re-run)
 *
 * Run: npx ts-node execution/run_export_sql.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateTables, CheckConstraints } from './export_sql';
import { Schema } from './utils/schema_validator';

// ─── DesignDB Application Schema Definition ───────────────────────────────────
const designDbSchema: Schema = {
  entities: [
    {
      name: 'users',
      description: 'DesignDB user accounts',
      attributes: [
        { name: 'user_id',    dataType: 'INTEGER',      isPrimaryKey: true,  isNullable: false, isUnique: true  },
        { name: 'username',   dataType: 'VARCHAR(255)',  isPrimaryKey: false, isNullable: false, isUnique: true  },
        { name: 'email',      dataType: 'VARCHAR(255)',  isPrimaryKey: false, isNullable: false, isUnique: true  },
        { name: 'full_name',  dataType: 'VARCHAR(255)',  isPrimaryKey: false, isNullable: true,  isUnique: false },
        { name: 'role',       dataType: 'VARCHAR(50)',   isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: "'designer'" },
        { name: 'created_at', dataType: 'TIMESTAMP',     isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'is_active',  dataType: 'BOOLEAN',       isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'TRUE' },
      ],
    },
    {
      name: 'projects',
      description: 'ERD design projects owned by users',
      attributes: [
        { name: 'project_id',  dataType: 'INTEGER',     isPrimaryKey: true,  isNullable: false, isUnique: true  },
        { name: 'user_id',     dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'title',       dataType: 'VARCHAR(255)', isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'description', dataType: 'TEXT',         isPrimaryKey: false, isNullable: true,  isUnique: false },
        { name: 'is_public',   dataType: 'BOOLEAN',      isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'FALSE' },
        { name: 'created_at',  dataType: 'TIMESTAMP',    isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at',  dataType: 'TIMESTAMP',    isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'CURRENT_TIMESTAMP' },
      ],
    },
    {
      name: 'schemas',
      description: 'Versioned database schemas within a project',
      attributes: [
        { name: 'schema_id',     dataType: 'INTEGER',     isPrimaryKey: true,  isNullable: false, isUnique: true  },
        { name: 'project_id',    dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'schema_name',   dataType: 'VARCHAR(255)', isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'version',       dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: '1' },
        { name: 'is_normalized', dataType: 'BOOLEAN',      isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'FALSE' },
        { name: 'dialect',       dataType: 'VARCHAR(50)',  isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: "'mysql'" },
        { name: 'created_at',    dataType: 'TIMESTAMP',    isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'CURRENT_TIMESTAMP' },
      ],
    },
    {
      name: 'entities',
      description: 'Database tables defined within a schema',
      attributes: [
        { name: 'entity_id',           dataType: 'INTEGER',     isPrimaryKey: true,  isNullable: false, isUnique: true  },
        { name: 'schema_id',           dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'entity_name',         dataType: 'VARCHAR(255)', isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'description',         dataType: 'TEXT',         isPrimaryKey: false, isNullable: true,  isUnique: false },
        { name: 'estimated_row_count', dataType: 'INTEGER',      isPrimaryKey: false, isNullable: true,  isUnique: false, defaultValue: '0' },
      ],
    },
    {
      name: 'attributes',
      description: 'Columns defined within an entity',
      attributes: [
        { name: 'attribute_id',  dataType: 'INTEGER',     isPrimaryKey: true,  isNullable: false, isUnique: true  },
        { name: 'entity_id',     dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'attr_name',     dataType: 'VARCHAR(255)', isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'data_type',     dataType: 'VARCHAR(100)', isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'is_primary_key',dataType: 'BOOLEAN',      isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'FALSE' },
        { name: 'is_nullable',   dataType: 'BOOLEAN',      isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'TRUE'  },
        { name: 'is_unique',     dataType: 'BOOLEAN',      isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: 'FALSE' },
        { name: 'default_value', dataType: 'VARCHAR(255)', isPrimaryKey: false, isNullable: true,  isUnique: false },
      ],
    },
    {
      name: 'relationships',
      description: 'FK relationships between entities in a schema',
      attributes: [
        { name: 'relationship_id', dataType: 'INTEGER',     isPrimaryKey: true,  isNullable: false, isUnique: true  },
        { name: 'schema_id',       dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'from_entity_id',  dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'to_entity_id',    dataType: 'INTEGER',     isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'rel_type',        dataType: 'VARCHAR(50)',  isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'foreign_key',     dataType: 'VARCHAR(255)', isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'referenced_key',  dataType: 'VARCHAR(255)', isPrimaryKey: false, isNullable: false, isUnique: false },
        { name: 'on_delete',       dataType: 'VARCHAR(20)',  isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: "'RESTRICT'" },
        { name: 'on_update',       dataType: 'VARCHAR(20)',  isPrimaryKey: false, isNullable: false, isUnique: false, defaultValue: "'CASCADE'"  },
      ],
    },
  ],

  relationships: [
    { fromEntity: 'projects',      toEntity: 'users',    type: 'many-to-one', foreignKey: 'user_id',        referencedKey: 'user_id',    onDelete: 'CASCADE',  onUpdate: 'CASCADE' },
    { fromEntity: 'schemas',       toEntity: 'projects', type: 'many-to-one', foreignKey: 'project_id',     referencedKey: 'project_id', onDelete: 'CASCADE',  onUpdate: 'CASCADE' },
    { fromEntity: 'entities',      toEntity: 'schemas',  type: 'many-to-one', foreignKey: 'schema_id',      referencedKey: 'schema_id',  onDelete: 'CASCADE',  onUpdate: 'CASCADE' },
    { fromEntity: 'attributes',    toEntity: 'entities', type: 'many-to-one', foreignKey: 'entity_id',      referencedKey: 'entity_id',  onDelete: 'CASCADE',  onUpdate: 'CASCADE' },
    { fromEntity: 'relationships', toEntity: 'schemas',  type: 'many-to-one', foreignKey: 'schema_id',      referencedKey: 'schema_id',  onDelete: 'CASCADE',  onUpdate: 'CASCADE' },
    { fromEntity: 'relationships', toEntity: 'entities', type: 'many-to-one', foreignKey: 'from_entity_id', referencedKey: 'entity_id',  onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
    { fromEntity: 'relationships', toEntity: 'entities', type: 'many-to-one', foreignKey: 'to_entity_id',   referencedKey: 'entity_id',  onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
  ],
};

// ─── CHECK Constraints ────────────────────────────────────────────────────────
const checks: CheckConstraints = {
  'users.role':             `role IN ('admin', 'designer', 'viewer', 'editor')`,
  'users.is_active':        `is_active IN (0, 1)`,
  'projects.is_public':     `is_public IN (0, 1)`,
  'schemas.version':        `version >= 1`,
  'schemas.is_normalized':  `is_normalized IN (0, 1)`,
  'schemas.dialect':        `dialect IN ('mysql', 'postgresql', 'sqlite')`,
  'entities.estimated_row_count': `estimated_row_count >= 0`,
  'attributes.is_primary_key': `is_primary_key IN (0, 1)`,
  'attributes.is_nullable':    `is_nullable IN (0, 1)`,
  'attributes.is_unique':      `is_unique IN (0, 1)`,
  'relationships.rel_type': `rel_type IN ('one-to-one', 'one-to-many', 'many-to-one', 'many-to-many')`,
  'relationships.on_delete': `on_delete IN ('CASCADE', 'RESTRICT', 'SET NULL', 'NO ACTION')`,
  'relationships.on_update': `on_update IN ('CASCADE', 'RESTRICT', 'NO ACTION')`,
};

// ─── Generate & Write ─────────────────────────────────────────────────────────
const OUT_DIR = path.resolve(__dirname, '../data');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const dialects: Array<'mysql' | 'postgres' | 'sqlite'> = ['mysql', 'postgres', 'sqlite'];

for (const dialect of dialects) {
  const sql = generateTables(designDbSchema, dialect, {
    includeDropTables:  true,
    useAlterTable:      false,
    checkConstraints:   checks,
    createIndexes:      true,
  });

  const outFile = path.join(OUT_DIR, `schema_${dialect}.sql`);
  fs.writeFileSync(outFile, sql, 'utf8');
  console.log(`✅  ${dialect.padEnd(10)} → ${outFile}`);
}

console.log('\n📦 M4: DDL export complete — 3 dialects, CHECK constraints, FK indexes included.');
