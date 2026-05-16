-- DesignDB Export DDL
-- Dialect: MYSQL
-- Generated At: 2026-05-16T09:27:45.863Z

-- ==========================================
-- DROP TABLES
-- ==========================================
DROP TABLE IF EXISTS relationships;
DROP TABLE IF EXISTS attributes;
DROP TABLE IF EXISTS entities;
DROP TABLE IF EXISTS schemas;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS `users`;

-- ==========================================
-- CREATE TABLES
-- ==========================================
CREATE TABLE `users` (
    user_id INTEGER AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'designer',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_users_role CHECK (role IN ('admin', 'designer', 'viewer', 'editor')),
    CONSTRAINT chk_users_is_active CHECK (is_active IN (0, 1))
);

CREATE TABLE projects (
    project_id INTEGER AUTO_INCREMENT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_projects_user_id FOREIGN KEY (user_id) REFERENCES `users`(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_projects_is_public CHECK (is_public IN (0, 1))
);

CREATE TABLE schemas (
    schema_id INTEGER AUTO_INCREMENT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    schema_name VARCHAR(255) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_normalized BOOLEAN NOT NULL DEFAULT FALSE,
    dialect VARCHAR(50) NOT NULL DEFAULT 'mysql',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_schemas_project_id FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_schemas_version CHECK (version >= 1),
    CONSTRAINT chk_schemas_is_normalized CHECK (is_normalized IN (0, 1)),
    CONSTRAINT chk_schemas_dialect CHECK (dialect IN ('mysql', 'postgresql', 'sqlite'))
);

CREATE TABLE entities (
    entity_id INTEGER AUTO_INCREMENT PRIMARY KEY,
    schema_id INTEGER NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_row_count INTEGER DEFAULT 0,
    CONSTRAINT fk_entities_schema_id FOREIGN KEY (schema_id) REFERENCES schemas(schema_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_entities_estimated_row_count CHECK (estimated_row_count >= 0)
);

CREATE TABLE attributes (
    attribute_id INTEGER AUTO_INCREMENT PRIMARY KEY,
    entity_id INTEGER NOT NULL,
    attr_name VARCHAR(255) NOT NULL,
    data_type VARCHAR(100) NOT NULL,
    is_primary_key BOOLEAN NOT NULL DEFAULT FALSE,
    is_nullable BOOLEAN NOT NULL DEFAULT TRUE,
    is_unique BOOLEAN NOT NULL DEFAULT FALSE,
    default_value VARCHAR(255),
    CONSTRAINT fk_attributes_entity_id FOREIGN KEY (entity_id) REFERENCES entities(entity_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT chk_attributes_is_primary_key CHECK (is_primary_key IN (0, 1)),
    CONSTRAINT chk_attributes_is_nullable CHECK (is_nullable IN (0, 1)),
    CONSTRAINT chk_attributes_is_unique CHECK (is_unique IN (0, 1))
);

CREATE TABLE relationships (
    relationship_id INTEGER AUTO_INCREMENT PRIMARY KEY,
    schema_id INTEGER NOT NULL,
    from_entity_id INTEGER NOT NULL,
    to_entity_id INTEGER NOT NULL,
    rel_type VARCHAR(50) NOT NULL,
    foreign_key VARCHAR(255) NOT NULL,
    referenced_key VARCHAR(255) NOT NULL,
    on_delete VARCHAR(20) NOT NULL DEFAULT 'RESTRICT',
    on_update VARCHAR(20) NOT NULL DEFAULT 'CASCADE',
    CONSTRAINT fk_relationships_schema_id FOREIGN KEY (schema_id) REFERENCES schemas(schema_id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_relationships_from_entity_id FOREIGN KEY (from_entity_id) REFERENCES entities(entity_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_relationships_to_entity_id FOREIGN KEY (to_entity_id) REFERENCES entities(entity_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT chk_relationships_rel_type CHECK (rel_type IN ('one-to-one', 'one-to-many', 'many-to-one', 'many-to-many')),
    CONSTRAINT chk_relationships_on_delete CHECK (on_delete IN ('CASCADE', 'RESTRICT', 'SET NULL', 'NO ACTION')),
    CONSTRAINT chk_relationships_on_update CHECK (on_update IN ('CASCADE', 'RESTRICT', 'NO ACTION'))
);

-- ==========================================
-- INDEXES (FK columns)
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects (user_id);
CREATE INDEX IF NOT EXISTS idx_schemas_project_id ON schemas (project_id);
CREATE INDEX IF NOT EXISTS idx_entities_schema_id ON entities (schema_id);
CREATE INDEX IF NOT EXISTS idx_attributes_entity_id ON attributes (entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_schema_id ON relationships (schema_id);
CREATE INDEX IF NOT EXISTS idx_relationships_from_entity_id ON relationships (from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relationships_to_entity_id ON relationships (to_entity_id);

