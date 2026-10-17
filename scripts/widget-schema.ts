// writes docs/widget.schema.json from src/shared/widgetSchema.ts (test/widget-check.test.ts fails while they differ):
// node --experimental-strip-types scripts/widget-schema.ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WIDGET_SCHEMA } from '../src/shared/widgetSchema.ts'

writeFileSync(fileURLToPath(new URL('../docs/widget.schema.json', import.meta.url)), `${JSON.stringify(WIDGET_SCHEMA, null, 2)}\n`)
