const fs = require('fs-extra');
const path = require('path');

// Store-ready: iosApp/iosApp/PrivacyInfo.xcprivacy marks what a flag adds. A block (each marker on its own
// line) goes when its flag is off and loses only its markers when on; the tracking value line flips.
const PRIVACY_MANIFEST = ['iosApp', 'iosApp', 'PrivacyInfo.xcprivacy'];
const BLOCKS = ['ads', 'purchases', 'backend', 'insights'];
const TRACKING_LINE = /<true\/><!-- cmpose:ads-tracking -->/;

function renderPrivacyManifest(content, flags) {
    let lines = content.split('\n');
    for (const name of BLOCKS) lines = applyBlock(lines, name, flags[name] === true);
    let out = lines.join('\n').replace(TRACKING_LINE, () => (flags.ads === true ? '<true/>' : '<false/>'));
    // An array left with whitespace only becomes <array/>
    out = out.replace(/<array>\n(?:[ \t]*\n)*[ \t]*<\/array>/g, '<array/>');
    return out;
}

function applyBlock(lines, name, keep) {
    const open = `<!-- cmpose:${name} -->`;
    const close = `<!-- /cmpose:${name} -->`;
    const result = [];
    let inside = false;
    for (const line of lines) {
        if (line.trim() === open) { inside = true; continue; }
        if (line.trim() === close) { inside = false; continue; }
        if (!inside || keep) result.push(line);
    }
    if (inside) throw new Error(`PrivacyInfo.xcprivacy: unclosed cmpose:${name} block`);
    return result;
}

async function writePrivacyManifest(projectPath, flags) {
    const file = path.join(projectPath, ...PRIVACY_MANIFEST);
    if (!(await fs.pathExists(file))) return;
    const content = await fs.readFile(file, 'utf8');
    const updated = renderPrivacyManifest(content, flags);
    if (updated !== content) await fs.writeFile(file, updated);
}

module.exports = { renderPrivacyManifest, writePrivacyManifest, PRIVACY_MANIFEST };
