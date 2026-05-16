import { Schema } from './utils/schema_validator';
import { logger } from './utils/logger';

export function generateMermaid(schema: Schema): string {
    logger.logInfo('generateMermaid', 'Starting diagram generation');
    
    let mermaidStr = 'erDiagram\n';

    for (const entity of schema.entities) {
        mermaidStr += `    ${entity.name} {\n`;
        for (const attr of entity.attributes) {
            const isPk = attr.isPrimaryKey ? ' PK' : '';
            const isFk = schema.relationships.some(r => r.fromEntity === entity.name && r.foreignKey === attr.name) ? ' FK' : '';
            const safeType = attr.dataType.replace(/\s+/g, '_');
            mermaidStr += `        ${safeType} ${attr.name}${isPk}${isFk}\n`;
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
        mermaidStr += `    ${rel.fromEntity} ${cardinality} ${rel.toEntity} : "${rel.foreignKey} -> ${rel.referencedKey}"\n`;
    }

    return mermaidStr;
}
