import { z } from 'zod';

// Models often answer `"defaultValue": 0` or `"size": 255` — accept numbers and booleans as their text, rather than
// rejecting the whole schema over it.
const text = z.preprocess((v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v), z.string().nullable().optional());

export const AttributeSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  isPrimaryKey: z.boolean().default(false),
  isNullable: z.boolean().default(false),
  isUnique: z.boolean().default(false),
  defaultValue: text,
  size: text,
  autoIncrement: z.boolean().optional(),
});

export const TableIndexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  type: z.string().default('BTREE'),
});

export const TableConstraintSchema = z.object({
  name: z.string(),
  expression: z.string(),
});

export const EntitySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  group: z.string().optional(),
  attributes: z.array(AttributeSchema),
  seedData: z.array(z.record(z.any())).optional(),
  indexes: z.array(TableIndexSchema).optional(),
  constraints: z.array(TableConstraintSchema).optional(),
});

export const RelationshipSchema = z.object({
  fromEntity: z.string(),
  toEntity: z.string(),
  type: z.enum(['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many']),
  foreignKey: z.string(),
  referencedKey: z.string(),
  onDelete: z.enum(['CASCADE', 'SET NULL', 'RESTRICT', 'NO ACTION']).default('RESTRICT'),
  onUpdate: z.enum(['CASCADE', 'RESTRICT', 'NO ACTION']).default('CASCADE'),
});

export const DatabaseSchema = z.object({
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema).default([]),
});

export type Attribute = z.infer<typeof AttributeSchema>;
export type Entity = z.infer<typeof EntitySchema>;
export type Relationship = z.infer<typeof RelationshipSchema>;
export type Schema = z.infer<typeof DatabaseSchema>;

export function validateSchema(data: unknown): { isValid: boolean; data?: Schema; errors?: any } {
  const result = DatabaseSchema.safeParse(data);
  if (result.success) {
    return { isValid: true, data: result.data };
  }
  return { isValid: false, errors: result.error.format() };
}
