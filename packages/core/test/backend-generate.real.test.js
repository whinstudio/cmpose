'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs-extra');
const { validateBackend } = require('../src/backend/validate');
const { applySharingOption } = require('../src/backend/options');
const { generateBackend } = require('../src/backend/generate');
const { verifyBackendProject } = require('../src/backend/verifier');

// The backend pipeline against the REAL template (CMPOSE_BACKEND_TEMPLATE_DIR, a checkout of the backend template).
// Skipped, not failed, when it is unset or holds no template.
const REAL = process.env.CMPOSE_BACKEND_TEMPLATE_DIR;
const HAS_TEMPLATE = Boolean(REAL) && fs.existsSync(path.join(REAL, 'tools', 'resolve-markers.sh'))
    && fs.existsSync(path.join(REAL, 'tools', 'sharing-paths.txt'));
const OPTIONS = HAS_TEMPLATE ? {}
    : { skip: REAL ? `no backend template at CMPOSE_BACKEND_TEMPLATE_DIR (${REAL})` : 'CMPOSE_BACKEND_TEMPLATE_DIR is not set' };
// Local state and build output, never part of a template copy
const EXCLUDED = new Set(['.git', 'build', '.gradle', '.kotlin', '.local-server', '.claude']);

async function copyTemplate(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-real-'));
    t.after(() => fs.remove(dir));
    await fs.copy(REAL, dir, { filter: (src) => !path.relative(REAL, src).split(path.sep).some((part) => EXCLUDED.has(part)) });
    return dir;
}

// Every file below dir outside tools/, with its bytes and executable bit
async function snapshot(dir, rel = '', out = new Map()) {
    for (const entry of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${entry.name}` : entry.name;
        if (r === 'tools') continue;
        if (entry.isDirectory()) { await snapshot(dir, r, out); continue; }
        const file = path.join(dir, r);
        out.set(r, { bytes: await fs.readFile(file), executable: ((await fs.stat(file)).mode & 0o111) !== 0 });
    }
    return out;
}

for (const mode of ['on', 'off']) {
    test(`sharing ${mode}: applySharingOption matches tools/resolve-markers.sh byte for byte`, OPTIONS, async (t) => {
        const ours = await copyTemplate(t);
        const reference = await copyTemplate(t);
        await applySharingOption(ours, mode === 'on');
        execFileSync('bash', [path.join(reference, 'tools', 'resolve-markers.sh'), reference, mode], { stdio: 'pipe' });

        const a = await snapshot(ours);
        const b = await snapshot(reference);
        assert.deepEqual([...a.keys()].sort(), [...b.keys()].sort());
        const differ = [...a.keys()].filter((rel) => !a.get(rel).bytes.equals(b.get(rel).bytes) || a.get(rel).executable !== b.get(rel).executable);
        assert.deepEqual(differ, []);
        assert.ok(a.size > 50, `a real template (${a.size} files)`);
        // the markers were resolved, not left alone on both sides
        assert.ok(![...a.values()].some(({ bytes }) => bytes.includes('cmpose:sharing')), 'no sharing marker left');
    });

    test(`sharing ${mode}: the whole generation passes the verifier`, OPTIONS, async (t) => {
        const projectDir = await copyTemplate(t);
        const { ok, value, errors } = validateBackend({
            projectName: 'DemoNotes', appName: 'demo-notes', packageName: 'com.example.demonotes', outputDir: projectDir, sharing: mode === 'on'
        });
        assert.ok(ok, JSON.stringify(errors));
        await generateBackend(value, { projectDir, templateRef: 'main', generatorVersion: 'test' });
        assert.deepEqual(await verifyBackendProject(projectDir, value), []);
        assert.ok(await fs.pathExists(path.join(projectDir, 'deploy', 'sql', 'create-demo-notes.sql')));
        assert.match(await fs.readFile(path.join(projectDir, 'deploy', 'docker-compose.demo-notes.yml'), 'utf8'), /DEMO_NOTES_MEM_LIMIT/);
        assert.ok(await fs.pathExists(path.join(projectDir, 'src', 'main', 'kotlin', 'com', 'example', 'demonotes', 'Main.kt')));
        assert.equal(await fs.pathExists(path.join(projectDir, 'src', 'main', 'kotlin', 'com', 'example', 'demonotes', 'sharing')), mode === 'on');
        for (const rel of ['gradlew', path.join('tools', 'deploy-lint.sh')]) {
            assert.ok(((await fs.stat(path.join(projectDir, rel))).mode & 0o111) !== 0, `${rel} stays executable`);
        }
        const tools = (await fs.readdir(path.join(projectDir, 'tools'))).sort();
        assert.deepEqual(tools, ['deploy-lint.sh']);
    });
}
