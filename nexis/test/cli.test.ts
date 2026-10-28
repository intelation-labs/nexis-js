import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// Compiled to .test-build/test/, next to .test-build/src/cli.js, which sits two levels below package.json like dist/esm/.
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

const run = (...args: string[]) => {
	const env = { ...process.env };
	delete env.NEXIS_API_KEY;
	return spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', input: '' });
};

describe('nexis CLI', () => {
	it('reports an unknown command before the missing API key', () => {
		const res = run('redcat', 'hello');
		assert.equal(res.status, 1);
		assert.match(res.stderr, /Unknown command "redcat"/);
		assert.match(res.stderr, /nexis --help/);
		assert.doesNotMatch(res.stderr, /API key/);
	});

	it('prints the package version', () => {
		for (const flag of ['--version', '-v']) {
			const res = run(flag);
			assert.equal(res.status, 0);
			assert.equal(res.stdout.trim(), pkg.version);
		}
	});
});
