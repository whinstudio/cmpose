'use strict';
const path = require('path');
const fs = require('fs-extra');
const { log } = require('./log');
const { appNameProblem } = require('./backend/validate');
const { generateBackend } = require('./backend/generate');

// A blank project's server/ is the cmpose backend template, generated in place as an included build (the root settings
// include it with includeBuild("server")): sharing on, sample off, the package <app package>.server, and the local
// server's folder at the project root (.local-server/, Compass's contract).

const SERVER_DIR = 'server';
const LOCAL_SERVER_DIR_LINE = 'localServerDir=../.local-server';
// The root settings' includeBuild("server") on a line that is not a comment (the template guards it with an if)
const INCLUDE_SERVER_BUILD = /^(?![ \t]*\/\/).*\bincludeBuild\("server"\)/m;
// The template's CI and the backend's own generation record: the app's CI and record cover server/
const SERVER_LEFTOVERS = ['.github', '.cmpose'];
const BASE_MAX = 27;

const serverPackageOf = (packageName) => `${packageName}.server`;

// The project name in kebab case (MyApp -> my-app, MyAPIApp -> my-api-app), cut at BASE_MAX without a trailing -
function kebabBase(projectName) {
    const kebab = String(projectName)
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^[^a-z]+/, '');
    return kebab.slice(0, BASE_MAX).replace(/-+$/, '');
}

/** The server's appName for a project: the project name in kebab case, then with -app, then with -server; the first
 * one the backend's appName rule accepts */
function deriveServerAppName(projectName) {
    const base = kebabBase(projectName);
    for (const candidate of [base, `${base}-app`, `${base}-server`]) {
        if (!appNameProblem(candidate)) return candidate;
    }
    throw new Error(`Cannot derive a server name from ${projectName}`);
}

// localServerDir=../.local-server as the file's own line (an existing localServerDir line is replaced)
async function writeLocalServerDir(serverDir) {
    const file = path.join(serverDir, 'gradle.properties');
    const content = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf8') : '';
    const lines = content.split('\n').filter((line) => !/^\s*localServerDir\s*=/.test(line));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(LOCAL_SERVER_DIR_LINE);
    await fs.writeFile(file, `${lines.join('\n')}\n`);
}

/** Moves a fresh backend template copy (backendTemplate.dir) to <projectDir>/server and generates it there. Fails when
 * server/ already exists. Returns the server's appName, package and template.
 * On a failure part way, server/ may be half written: the caller discards the project dir. */
async function placeServer(projectDir, { packageName, projectName, backendTemplate, generatorVersion = null, now = new Date() }) {
    const { dir, repo = null, ref = null, commit = null } = backendTemplate || {};
    if (!dir) throw new Error('backend: the backend template is required (backendTemplate)');
    const serverDir = path.join(projectDir, SERVER_DIR);
    if (await fs.pathExists(serverDir)) throw new Error(`${SERVER_DIR}/ already exists in the project`);

    // 1. move: a rename on the same file system, otherwise a copy and a removal
    await fs.move(dir, serverDir);

    // 2. generate
    const appName = deriveServerAppName(projectName);
    const serverPackage = serverPackageOf(packageName);
    await generateBackend({ projectName, appName, packageName: serverPackage, sharing: true, sample: false }, {
        projectDir: serverDir, templateRef: ref, templateCommit: commit, generatorVersion, now
    });

    // 3. the local server's folder is the project root's .local-server/
    await writeLocalServerDir(serverDir);

    // 4. leftovers
    for (const leftover of SERVER_LEFTOVERS) await fs.remove(path.join(serverDir, leftover));
    log.info(`✅ Server ready (${appName}, ${serverPackage})`);
    return { appName, packageName: serverPackage, template: { repo, ref, commit } };
}

module.exports = { deriveServerAppName, placeServer, serverPackageOf, SERVER_DIR, LOCAL_SERVER_DIR_LINE, INCLUDE_SERVER_BUILD };
