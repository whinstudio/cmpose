'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

// The files git tracks in a work tree (ignored and untracked files left out) when `root` is its top level; null when it
// is not a work tree or only a subdirectory of another repo
function trackedFiles(root) {
    try {
        const top = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { stdio: 'pipe' }).toString('utf8').trim();
        if (path.resolve(top) !== fs.realpathSync(root)) return null;
        return execFileSync('git', ['-C', root, 'ls-files', '-z'], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 })
            .toString('utf8').split('\0').filter(Boolean);
    } catch {
        return null;
    }
}

// Copies the real CMP template: only its tracked files when it is a work tree (a maintainer checkout's build output and
// generated files stay out), else everything but .git. `filter` gets the absolute source path.
async function copyRealTemplate(real, dest, filter = () => true) {
    const tracked = trackedFiles(real);
    if (tracked) {
        for (const rel of tracked) {
            const src = path.join(real, rel);
            if (filter(src) && fs.existsSync(src)) await fs.copy(src, path.join(dest, rel));
        }
    } else {
        await fs.copy(real, dest, { filter: (src) => path.basename(src) !== '.git' && filter(src) });
    }
}

module.exports = { trackedFiles, copyRealTemplate };
