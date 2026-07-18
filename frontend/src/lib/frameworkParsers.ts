import type { ParsedSchema, ParsedEntity } from "./sqlParser";

/**
 * Parses a Prisma schema (.prisma) file content into a ParsedSchema structure.
 */
export function parsePrisma(schemaText: string): ParsedSchema {
  const schema: ParsedSchema = {
    entities: [],
    relationships: []
  };

  // Clean comments (// or ///)
  const cleanText = schemaText.replace(/\/\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");

  // Match model blocks
  const modelRegex = /model\s+(\w+)\s*{([\s\S]*?)}/gi;
  let match;

  while ((match = modelRegex.exec(cleanText)) !== null) {
    const modelName = match[1].trim();
    const modelBody = match[2].trim();

    const entity: ParsedEntity = {
      name: modelName,
      attributes: []
    };

    // Split lines
    const lines = modelBody.split(/\r?\n/);
    const relationFields: { fieldName: string; type: string; line: string }[] = [];

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("@@")) return; // ignore model-level attributes

      // Tokenize
      const tokens = trimmed.split(/\s+/);
      if (tokens.length < 2) return;

      const fieldName = tokens[0].trim();
      const fieldType = tokens[1].replace("?", "").replace("[]", "").trim(); // strip optional/array markers

      // Check attributes
      const isPk = trimmed.includes("@id");

      // Relations are declared as custom model types
      const isRelationField = /@relation/i.test(trimmed);
      if (isRelationField) {
        relationFields.push({ fieldName, type: fieldType, line: trimmed });
        return; // skip adding the relation mapper as a regular column
      }

      // Skip array types representing other side of relation in Prisma unless it's a regular field type
      const isCollectionRelation = tokens[1].endsWith("[]");
      if (isCollectionRelation && !["Int", "String", "Boolean", "DateTime", "Float", "Decimal", "Json"].includes(fieldType)) {
        return; 
      }

      entity.attributes.push({
        name: fieldName,
        dataType: mapPrismaType(fieldType),
        isPrimaryKey: isPk,
        isForeignKey: false // will be resolved below
      });
    });

    // Resolve Prisma relations defined on this model
    relationFields.forEach((rel) => {
      // Find fields: [authorId], references: [id]
      const fieldsMatch = rel.line.match(/fields:\s*\[(.*?)\]/);
      const refsMatch = rel.line.match(/references:\s*\[(.*?)\]/);

      if (fieldsMatch && refsMatch) {
        const fkCols = fieldsMatch[1].split(",").map(c => c.trim());
        const pkCols = refsMatch[1].split(",").map(c => c.trim());

        if (fkCols.length > 0 && pkCols.length > 0) {
          const fkCol = fkCols[0];
          const pkCol = pkCols[0];

          // Flag FK in attributes list
          const attr = entity.attributes.find(a => a.name === fkCol);
          if (attr) {
            attr.isForeignKey = true;
          }

          schema.relationships.push({
            fromEntity: modelName,
            toEntity: rel.type,
            foreignKey: fkCol,
            referencedKey: pkCol,
            type: "one-to-many" // Default
          });
        }
      }
    });

    schema.entities.push(entity);
  }

  return schema;
}

function mapPrismaType(type: string): string {
  switch (type.toLowerCase()) {
    case "int": return "integer";
    case "bigint": return "bigint";
    case "string": return "varchar(255)";
    case "boolean": return "boolean";
    case "datetime": return "timestamp";
    case "float": return "float";
    case "decimal": return "decimal(10,2)";
    case "json": return "json";
    case "bytes": return "bytea";
    default: return type.toLowerCase();
  }
}

/**
 * Parses Django models (.py) file content into a ParsedSchema structure.
 */
export function parseDjango(modelsText: string): ParsedSchema {
  const schema: ParsedSchema = {
    entities: [],
    relationships: []
  };

  // Match class ClassName(models.Model):
  const classRegex = /class\s+(\w+)\s*\((?:models\.)?Model\s*\):([\s\S]*?)(?=(?:class\s+\w+|$))/gi;
  let match;

  while ((match = classRegex.exec(modelsText)) !== null) {
    const className = match[1].trim();
    const classBody = match[2];

    const entity: ParsedEntity = {
      name: className,
      attributes: []
    };

    // Django automatically creates an 'id' primary key if none is declared
    let hasExplicitPk = false;

    // Split lines
    const lines = classBody.split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("def ") || trimmed.startsWith("class ")) return;

      // Match field definition: name = models.FieldType(...)
      const fieldMatch = trimmed.match(/^(\w+)\s*=\s*(?:models\.)?(\w+Field)\((.*?)\)/);
      if (!fieldMatch) return;

      const fieldName = fieldMatch[1].trim();
      const fieldType = fieldMatch[2].trim();
      const fieldArgs = fieldMatch[3].trim();

      const isPk = fieldArgs.includes("primary_key=True");
      if (isPk) hasExplicitPk = true;

      // Handle ForeignKey or OneToOneField
      if (fieldType === "ForeignKey" || fieldType === "OneToOneField") {
        // Match parent model name (first positional argument or to="Parent")
        let parentModel = "";
        const toMatch = fieldArgs.match(/to\s*=\s*['"]?(\w+)['"]?/);
        if (toMatch) {
          parentModel = toMatch[1];
        } else {
          // Positional argument
          const posMatch = fieldArgs.match(/^['"]?(\w+)['"]?/);
          if (posMatch) parentModel = posMatch[1];
        }

        if (parentModel) {
          // Django conventions appends _id to ForeignKey DB columns
          const dbColumnMatch = fieldArgs.match(/db_column\s*=\s*['"]?(\w+)['"]?/);
          const colName = dbColumnMatch ? dbColumnMatch[1] : `${fieldName}_id`;

          entity.attributes.push({
            name: colName,
            dataType: "integer",
            isPrimaryKey: isPk,
            isForeignKey: true
          });

          schema.relationships.push({
            fromEntity: className,
            toEntity: parentModel,
            foreignKey: colName,
            referencedKey: "id",
            type: fieldType === "OneToOneField" ? "one-to-one" : "one-to-many"
          });
          return;
        }
      }

      entity.attributes.push({
        name: fieldName,
        dataType: mapDjangoType(fieldType, fieldArgs),
        isPrimaryKey: isPk,
        isForeignKey: false
      });
    });

    if (!hasExplicitPk) {
      entity.attributes.unshift({
        name: "id",
        dataType: "integer",
        isPrimaryKey: true,
        isForeignKey: false
      });
    }

    schema.entities.push(entity);
  }

  return schema;
}

function mapDjangoType(fieldType: string, args: string): string {
  switch (fieldType) {
    case "AutoField": return "serial";
    case "BigAutoField": return "bigserial";
    case "IntegerField": return "integer";
    case "BigIntegerField": return "bigint";
    case "SmallIntegerField": return "smallint";
    case "CharField":
      const lenMatch = args.match(/max_length\s*=\s*(\d+)/);
      return lenMatch ? `varchar(${lenMatch[1]})` : "varchar(255)";
    case "TextField": return "text";
    case "BooleanField": return "boolean";
    case "DateTimeField": return "timestamp";
    case "DateField": return "date";
    case "FloatField": return "float";
    case "DecimalField": return "decimal(10,2)";
    case "UUIDField": return "uuid";
    case "EmailField": return "varchar(254)";
    default: return "varchar(255)";
  }
}

/**
 * Parses Rails active record schema (schema.rb) file content into a ParsedSchema structure.
 */
export function parseRails(schemaText: string): ParsedSchema {
  const schema: ParsedSchema = {
    entities: [],
    relationships: []
  };

  // Match create_table blocks
  const tableRegex = /create_table\s+["'](\w+)["']\s*(?:,\s*.*?)?\s*do\s*\|t\|([\s\S]*?)end/gi;
  let match;

  while ((match = tableRegex.exec(schemaText)) !== null) {
    const tableName = match[1].trim();
    const tableBody = match[2];

    const entity: ParsedEntity = {
      name: tableName,
      attributes: [
        { name: "id", dataType: "bigint", isPrimaryKey: true, isForeignKey: false } // standard Rails auto ID
      ]
    };

    // Split lines
    const lines = tableBody.split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;

      // Match t.string "name", t.integer "user_id", etc.
      const colMatch = trimmed.match(/t\.(\w+)\s+["'](\w+)["']/);
      if (!colMatch) return;

      const colType = colMatch[1];
      const colName = colMatch[2];

      entity.attributes.push({
        name: colName,
        dataType: mapRailsType(colType),
        isPrimaryKey: false,
        isForeignKey: colName.endsWith("_id") // Basic heuristic
      });
    });

    schema.entities.push(entity);
  }

  // Match global foreign key relationships
  // add_foreign_key "posts", "users" -> posts has user_id FK targeting users.id
  const fkRegex = /add_foreign_key\s+["'](\w+)["']\s*,\s*["'](\w+)["'](?:\s*,\s*column:\s*["'](\w+)["'])?/gi;
  let fkMatch;
  while ((fkMatch = fkRegex.exec(schemaText)) !== null) {
    const childTable = fkMatch[1];
    const parentTable = fkMatch[2];
    // Rails default FK column is parentTableSingular_id
    const defaultCol = `${parentTable.replace(/s$/, "")}_id`;
    const fkCol = fkMatch[3] || defaultCol;

    schema.relationships.push({
      fromEntity: childTable,
      toEntity: parentTable,
      foreignKey: fkCol,
      referencedKey: "id",
      type: "one-to-many"
    });

    // Make sure we set isForeignKey: true in attributes
    const entityObj = schema.entities.find(e => e.name === childTable);
    if (entityObj) {
      const attr = entityObj.attributes.find(a => a.name === fkCol);
      if (attr) {
        attr.isForeignKey = true;
      }
    }
  }

  return schema;
}

function mapRailsType(type: string): string {
  switch (type) {
    case "integer": return "integer";
    case "bigint": return "bigint";
    case "string": return "varchar(255)";
    case "text": return "text";
    case "boolean": return "boolean";
    case "datetime": return "timestamp";
    case "timestamp": return "timestamp";
    case "date": return "date";
    case "float": return "float";
    case "decimal": return "decimal(10,2)";
    case "binary": return "blob";
    default: return type;
  }
}
