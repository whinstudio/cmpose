'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs-extra');

const FIXTURE = path.join(__dirname, 'fixtures', 'backend-template');
const TEMPLATE_PKG_DIR = 'io/cmpose/backendtemplate';
const EXECUTABLES = ['gradlew', 'tools/deploy-lint.sh', 'tools/gate.sh', 'tools/resolve-markers.sh'];

// A fresh copy of the backend fixture with a binary wrapper jar and the template's executable bits
async function fixtureCopy(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cmpose-backend-'));
    t.after(() => fs.remove(dir));
    await fs.copy(FIXTURE, dir);
    await fs.outputFile(path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.jar'), Buffer.from([0x50, 0x4b, 0, 0, 0x63, 0x6d]));
    for (const rel of EXECUTABLES) await fs.chmod(path.join(dir, rel), 0o755);
    return dir;
}

const read = (dir, rel) => fs.readFile(path.join(dir, rel), 'utf8');
const exists = (dir, rel) => fs.pathExists(path.join(dir, rel));
const isExecutable = async (dir, rel) => ((await fs.stat(path.join(dir, rel))).mode & 0o111) !== 0;

module.exports = { FIXTURE, TEMPLATE_PKG_DIR, fixtureCopy, read, exists, isExecutable };
