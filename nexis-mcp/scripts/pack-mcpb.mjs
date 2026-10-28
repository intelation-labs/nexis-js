import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Builds nexis-mcp.mcpb (for Smithery and one-click Claude Desktop installs) from the built dist/.
// Dependencies come from npm, not the workspace, so @intelation/nexis must already be published.
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = pkg.version;

// Staged outside the repo so npm doesn't treat it as part of the workspace.
const stage = join(tmpdir(), 'nexis-mcp-mcpb');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
cpSync('dist', `${stage}/dist`, { recursive: true, filter: (src) => !src.endsWith('.map') });
for (const file of ['README.md', 'LICENSE.md']) cpSync(file, `${stage}/${file}`);
delete pkg.devDependencies;
delete pkg.scripts;
writeFileSync(`${stage}/package.json`, JSON.stringify(pkg, null, '\t') + '\n');
writeFileSync(`${stage}/manifest.json`, JSON.stringify(manifest, null, '\t') + '\n');

execSync('npm install --omit=dev --no-package-lock --no-audit --no-fund', { cwd: stage, stdio: 'inherit' });
execSync(`npx -y @anthropic-ai/mcpb pack "${stage}" "${resolve('nexis-mcp.mcpb')}"`, { stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
