import { Schema } from './utils/schema_validator';
import { logger } from './utils/logger';

// Mermaid's ER grammar only takes word tokens for names and types (`DECIMAL(10,2)` and `line-item` do not parse) —
// the same clean-up as the diagram exporter (lib/export/mermaid).
const ident = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(?=\d)/, '_') || '_';
const typeName = (t: string) => ident(t.replace(/\(.*?\)/g, '').trim().replace(/\s+/g, '_'));

export function generateMermaid(schema: Schema): string {
    logger.logInfo('generateMermaid', 'Starting diagram generation');

    let mermaidStr = 'erDiagram\n';

    for (const entity of schema.entities) {
        mermaidStr += `    ${ident(entity.name)} {\n`;
        for (const attr of entity.attributes) {
            const isFk = schema.relationships.some(r => r.fromEntity === entity.name && r.foreignKey === attr.name);
            const keys = [attr.isPrimaryKey ? 'PK' : '', isFk ? 'FK' : ''].filter(Boolean).join(',');
            mermaidStr += `        ${typeName(attr.dataType)} ${ident(attr.name)}${keys ? ' ' + keys : ''}\n`;
        }
        mermaidStr += `    }\n\n`;
    }

    for (const rel of schema.relationships) {
        let cardinality = '';
        switch (rel.type) {
            case 'one-to-one': cardinality = '||--||'; break;
            case 'one-to-many': cardinality = '||--o{'; break;
            case 'many-to-one': cardinality = '}o--||'; break;
            case 'many-to-many': cardinality = '}o--o{'; break;
            default: cardinality = '||--o{';
        }
        mermaidStr += `    ${ident(rel.fromEntity)} ${cardinality} ${ident(rel.toEntity)} : "${rel.foreignKey.replace(/"/g, "'")} -> ${rel.referencedKey.replace(/"/g, "'")}"\n`;
    }

    return mermaidStr;
}
