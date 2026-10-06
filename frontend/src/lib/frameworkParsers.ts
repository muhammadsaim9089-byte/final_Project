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
 *
 * Top-level `class X(models.Model)` blocks become tables (an `id` key is added unless a field is `primary_key=True`);
 * ForeignKey / OneToOneField become `<field>_id` columns with a relationship, and ManyToManyField becomes Django's join
 * table `<Model>_<field>` (unless it names its own `through=` model). Field definitions may span several lines.
 */
export function parseDjango(modelsText: string): ParsedSchema {
  const schema: ParsedSchema = {
    entities: [],
    relationships: []
  };

  // top-level model classes only: an indented `class Meta:` stays part of its model
  const classRegex = /^class\s+(\w+)\s*\((?:models\.)?Model\s*\):([\s\S]*?)(?=^class\s|(?![\s\S]))/gm;
  let match;

  while ((match = classRegex.exec(modelsText)) !== null) {
    const className = match[1].trim();
    const entity: ParsedEntity = { name: className, attributes: [] };
    const joinTables: ParsedEntity[] = [];
    let hasExplicitPk = false;

    for (const statement of djangoStatements(match[2])) {
      // name = models.Type(args)   — args may contain nested parentheses
      const fieldMatch = statement.match(/^(\w+)\s*=\s*(?:models\.)?(\w+)\(([\s\S]*)\)\s*(?:#.*)?$/);
      if (!fieldMatch) continue;
      const [, fieldName, fieldType, rawArgs] = fieldMatch;
      const fieldArgs = rawArgs.replace(/\s+/g, " ").trim();
      const isRelation = fieldType === "ForeignKey" || fieldType === "OneToOneField";
      if (!isRelation && fieldType !== "ManyToManyField" && !fieldType.endsWith("Field")) continue;

      const isPk = /\bprimary_key\s*=\s*True\b/.test(fieldArgs);
      if (isPk) hasExplicitPk = true;

      if (fieldType === "ManyToManyField") {
        const target = djangoTarget(fieldArgs, className);
        if (!target || /(?:^|[\s,])through\s*=/.test(fieldArgs)) continue; // an explicit through model is its own class
        const join = `${className}_${fieldName}`;
        const self = target === className;
        const a = self ? `from_${className.toLowerCase()}_id` : `${className.toLowerCase()}_id`;
        const b = self ? `to_${className.toLowerCase()}_id` : `${target.toLowerCase()}_id`;
        joinTables.push({
          name: join,
          attributes: [
            { name: "id", dataType: "integer", isPrimaryKey: true, isForeignKey: false },
            { name: a, dataType: "integer", isPrimaryKey: false, isForeignKey: true },
            { name: b, dataType: "integer", isPrimaryKey: false, isForeignKey: true },
          ],
        });
        schema.relationships.push(
          { fromEntity: join, toEntity: className, foreignKey: a, referencedKey: "id", type: "one-to-many" },
          { fromEntity: join, toEntity: target, foreignKey: b, referencedKey: "id", type: "one-to-many" }
        );
        continue;
      }

      if (isRelation) {
        const parentModel = djangoTarget(fieldArgs, className);
        if (parentModel) {
          // Django appends _id to ForeignKey database columns
          const dbColumnMatch = fieldArgs.match(/\bdb_column\s*=\s*['"](\w+)['"]/);
          const colName = dbColumnMatch ? dbColumnMatch[1] : `${fieldName}_id`;
          entity.attributes.push({ name: colName, dataType: "integer", isPrimaryKey: isPk, isForeignKey: true });
          schema.relationships.push({
            fromEntity: className,
            toEntity: parentModel,
            foreignKey: colName,
            referencedKey: "id",
            type: fieldType === "OneToOneField" ? "one-to-one" : "one-to-many"
          });
          continue;
        }
      }

      entity.attributes.push({
        name: fieldName,
        dataType: mapDjangoType(fieldType, fieldArgs),
        isPrimaryKey: isPk,
        isForeignKey: false
      });
    }

    if (!hasExplicitPk) {
      entity.attributes.unshift({ name: "id", dataType: "integer", isPrimaryKey: true, isForeignKey: false });
    }

    schema.entities.push(entity, ...joinTables);
  }

  return schema;
}

/** A class body as statements: comments, blank lines and methods dropped, multi-line calls joined into one. */
function djangoStatements(body: string): string[] {
  const out: string[] = [];
  let pending = "";
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/\s+#.*$/, "").trim();
    if (!pending && (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("def ") || trimmed.startsWith("class ") || trimmed.startsWith("@"))) continue;
    pending = pending ? `${pending} ${trimmed}` : trimmed;
    for (const ch of trimmed) depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
    if (depth <= 0) {
      out.push(pending);
      pending = "";
      depth = 0;
    }
  }
  if (pending) out.push(pending);
  return out;
}

/** The model a relation field points at: `to=` or the first argument; "self", "app.Model" and AUTH_USER_MODEL resolved. */
function djangoTarget(args: string, self: string): string {
  const named = /(?:^|[\s,])to\s*=\s*([^,)\s]+)/.exec(args);
  const raw = (named ? named[1] : args.split(",")[0]).trim().replace(/^['"]|['"]$/g, "");
  if (!raw || raw.includes("=")) return "";
  if (raw === "self") return self;
  if (/AUTH_USER_MODEL$/.test(raw)) return "User";
  return raw.split(".").pop() || "";
}

function mapDjangoType(fieldType: string, args: string): string {
  switch (fieldType) {
    case "AutoField": return "serial";
    case "BigAutoField": return "bigserial";
    case "IntegerField": return "integer";
    case "BigIntegerField": return "bigint";
    case "SmallIntegerField": return "smallint";
    case "CharField": {
      const lenMatch = args.match(/max_length\s*=\s*(\d+)/);
      return lenMatch ? `varchar(${lenMatch[1]})` : "varchar(255)";
    }
    case "TextField": return "text";
    case "BooleanField": return "boolean";
    case "DateTimeField": return "timestamp";
    case "DateField": return "date";
    case "FloatField": return "float";
    case "DecimalField": {
      const digits = args.match(/max_digits\s*=\s*(\d+)/);
      const places = args.match(/decimal_places\s*=\s*(\d+)/);
      return digits && places ? `decimal(${digits[1]},${places[1]})` : "decimal(10,2)";
    }
    case "UUIDField": return "uuid";
    case "EmailField": return "varchar(254)";
    default: return "varchar(255)";
  }
}

/**
 * Parses Rails active record schema (schema.rb) file content into a ParsedSchema structure.
 *
 * Each `create_table … do |t| … end` block (closed by an `end` on its own line) is a table with Rails' `id` key —
 * `id: false` for none, `id: :uuid` (etc.) for its type; `add_foreign_key` lines are the relationships.
 */
export function parseRails(schemaText: string): ParsedSchema {
  const schema: ParsedSchema = {
    entities: [],
    relationships: []
  };

  const tableRegex = /^\s*create_table\s+["'](\w+)["']([^\n]*?)\s+do\s*\|t\|[^\n]*$([\s\S]*?)^\s*end\b/gm;
  let match;

  while ((match = tableRegex.exec(schemaText)) !== null) {
    const tableName = match[1].trim();
    const options = match[2];
    const tableBody = match[3];

    const entity: ParsedEntity = { name: tableName, attributes: [] };
    if (!/\bid:\s*false\b/.test(options)) {
      const idType = /\bid:\s*:(\w+)/.exec(options)?.[1];
      entity.attributes.push({ name: "id", dataType: idType ? mapRailsType(idType) : "bigint", isPrimaryKey: true, isForeignKey: false });
    }

    for (const line of tableBody.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      // t.string "name", limit: 3   ·   t.decimal "price", precision: 12, scale: 3
      const colMatch = trimmed.match(/^t\.(\w+)\s+["'](\w+)["'](.*)$/);
      if (!colMatch) continue;
      const [, colType, colName, opts] = colMatch;
      entity.attributes.push({
        name: colName,
        dataType: railsColumnType(colType, opts),
        isPrimaryKey: false,
        isForeignKey: colName.endsWith("_id") // Basic heuristic
      });
    }

    schema.entities.push(entity);
  }

  // add_foreign_key "posts", "users" → posts.user_id references users.id (column: overrides the column)
  const fkRegex = /add_foreign_key\s+["'](\w+)["']\s*,\s*["'](\w+)["'](?:[^\n]*?\bcolumn:\s*["'](\w+)["'])?/gi;
  let fkMatch;
  while ((fkMatch = fkRegex.exec(schemaText)) !== null) {
    const childTable = fkMatch[1];
    const parentTable = fkMatch[2];
    const fkCol = fkMatch[3] || `${singularize(parentTable)}_id`;

    schema.relationships.push({
      fromEntity: childTable,
      toEntity: parentTable,
      foreignKey: fkCol,
      referencedKey: "id",
      type: "one-to-many"
    });

    const attr = schema.entities.find(e => e.name === childTable)?.attributes.find(a => a.name === fkCol);
    if (attr) attr.isForeignKey = true;
  }

  return schema;
}

/** Rails' table-name singular, for the default foreign-key column (categories → category, addresses → address). */
function singularize(word: string): string {
  if (/[^aeiouy]ies$/i.test(word)) return word.slice(0, -3) + "y";
  if (/(x|ch|ss|sh)es$/i.test(word) || /(status|alias|bus)es$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

function railsColumnType(type: string, opts: string): string {
  if (type === "string") {
    const limit = /\blimit:\s*(\d+)/.exec(opts)?.[1];
    return limit ? `varchar(${limit})` : "varchar(255)";
  }
  if (type === "decimal") {
    const precision = /\bprecision:\s*(\d+)/.exec(opts)?.[1];
    const scale = /\bscale:\s*(\d+)/.exec(opts)?.[1];
    if (precision) return scale ? `decimal(${precision},${scale})` : `decimal(${precision})`;
  }
  return mapRailsType(type);
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
