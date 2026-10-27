import { writeFileSync } from 'node:fs';

// dist/cjs sits under a "type": "module" package, so it needs its own package.json to load as CommonJS.
writeFileSync('dist/cjs/package.json', '{"type":"commonjs"}\n');
