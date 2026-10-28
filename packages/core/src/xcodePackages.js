// Removes one Swift package from an Xcode project.pbxproj by its repository URL: the
// XCRemoteSwiftPackageReference, the XCSwiftPackageProductDependency objects that point at it,
// the PBXBuildFile objects that link those products, and every list entry naming one of those
// IDs. Sections left empty are dropped. Anything it does not recognise is left untouched, but a
// package it finds by URL and cannot take out is an error, never a silently unchanged project.

const OBJECT_START = /^\t\t([0-9A-F]{24})(?: \/\*.*?\*\/)? = \{/;
const OBJECT_END = '\t\t};';

// github.com/a/b, github.com/a/b.git and github.com/a/b/ name the same repository
function normalizeRepositoryUrl(url) {
    return url.trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

// The objects of the file, line based: { id, start, end, text } (end inclusive). A one-line
// object (`\t\tID /* … */ = {isa = PBXBuildFile; …; };`) has start === end.
function parseObjects(lines) {
    const objects = [];
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(OBJECT_START);
        if (!match) continue;
        if (lines[i].endsWith('};')) {
            objects.push({ id: match[1], start: i, end: i, text: lines[i] });
            continue;
        }
        let end = i + 1;
        while (end < lines.length && lines[end] !== OBJECT_END) end++;
        if (end >= lines.length) break;
        objects.push({ id: match[1], start: i, end, text: lines.slice(i, end + 1).join('\n') });
        i = end;
    }
    return objects;
}

function isa(object) {
    const match = object.text.match(/\bisa = (\w+);/);
    return match ? match[1] : null;
}

// Every repositoryURL value in the file, wherever and however it is indented
function repositoryUrls(content) {
    return [...content.matchAll(/\brepositoryURL = "?([^";\n]+)"?;/g)].map((match) => normalizeRepositoryUrl(match[1]));
}

// The parser is LF based: a project with any CRLF line is parsed as LF and written back with CRLF
// on every line (a mixed-ending file comes back all CRLF; Xcode itself writes LF)
function removeSwiftPackage(content, repositoryUrl) {
    const crlf = content.includes('\r\n');
    const result = removeSwiftPackageLf(crlf ? content.replace(/\r\n/g, '\n') : content, repositoryUrl);
    if (repositoryUrls(result).includes(normalizeRepositoryUrl(repositoryUrl))) {
        throw new Error(`removeSwiftPackage: ${repositoryUrl} is in project.pbxproj but its objects could not be parsed (unexpected formatting)`);
    }
    return crlf ? result.replace(/\n/g, '\r\n') : result;
}

function removeSwiftPackageLf(content, repositoryUrl) {
    const lines = content.split('\n');
    const objects = parseObjects(lines);

    // 1. The package reference(s) with this URL
    const references = packageReferences(objects, repositoryUrl);
    if (references.size === 0) return content;

    // 2. The products of that package
    const products = new Set(objects
        .filter((object) => isa(object) === 'XCSwiftPackageProductDependency')
        .filter((object) => {
            const pkg = object.text.match(/\bpackage = ([0-9A-F]{24})\b/);
            return pkg && references.has(pkg[1]);
        })
        .map((object) => object.id));

    // 3. The build files linking those products, then 4.-6. below
    let result = removeObjects(lines, objects, new Set([...references, ...products, ...linkingBuildFiles(objects, products)]));

    // 7. The project's packageReferences list, when it is now empty. A target's empty
    // packageProductDependencies list stays: Xcode writes it for every target.
    result = result.replace(/\n\t\t\tpackageReferences = \(\n\t\t\t\);(?=\n)/g, '');

    return result;
}

// The XCRemoteSwiftPackageReference ids whose repository is `repositoryUrl`
function packageReferences(objects, repositoryUrl) {
    const wanted = normalizeRepositoryUrl(repositoryUrl);
    return new Set(objects
        .filter((object) => isa(object) === 'XCRemoteSwiftPackageReference')
        .filter((object) => {
            const url = object.text.match(/\brepositoryURL = "?([^";\n]+)"?;/);
            return url && normalizeRepositoryUrl(url[1]) === wanted;
        })
        .map((object) => object.id));
}

// The PBXBuildFile objects that link one of `products`
function linkingBuildFiles(objects, products) {
    return objects
        .filter((object) => isa(object) === 'PBXBuildFile')
        .filter((object) => {
            const ref = object.text.match(/\bproductRef = ([0-9A-F]{24})\b/);
            return ref && products.has(ref[1]);
        })
        .map((object) => object.id);
}

// Drops the objects whose id is in `removed`, the list entries naming them and the sections left empty
function removeObjects(lines, objects, removed) {
    // 4. Their objects
    const drop = new Set();
    for (const object of objects) {
        if (!removed.has(object.id)) continue;
        for (let i = object.start; i <= object.end; i++) drop.add(i);
    }

    // 5. List entries naming them (`\t\t\t\tID /* … */,`)
    const listEntry = /^\t+([0-9A-F]{24})(?: \/\*.*?\*\/)?,$/;
    lines.forEach((line, i) => {
        const match = line.match(listEntry);
        if (match && removed.has(match[1])) drop.add(i);
    });

    // 6. Sections left empty, with the blank line that separated them
    return lines.filter((_, i) => !drop.has(i)).join('\n')
        .replace(/\n\n\/\* Begin (\w+) section \*\/\n\/\* End \1 section \*\/(?=\n)/g, '');
}

// Removes one product of a Swift package (its XCSwiftPackageProductDependency, the PBXBuildFile linking it
// and the list entries naming them); the package itself and its other products stay
function removeSwiftPackageProduct(content, repositoryUrl, productName) {
    const crlf = content.includes('\r\n');
    const lf = crlf ? content.replace(/\r\n/g, '\n') : content;
    const lines = lf.split('\n');
    const objects = parseObjects(lines);
    const references = packageReferences(objects, repositoryUrl);
    const products = new Set(objects
        .filter((object) => isa(object) === 'XCSwiftPackageProductDependency')
        .filter((object) => {
            const pkg = object.text.match(/\bpackage = ([0-9A-F]{24})\b/);
            const name = object.text.match(/\bproductName = "?([^";\n]+)"?;/);
            return pkg && references.has(pkg[1]) && name && name[1] === productName;
        })
        .map((object) => object.id));
    const result = products.size === 0 ? lf
        : removeObjects(lines, objects, new Set([...products, ...linkingBuildFiles(objects, products)]));
    // The comment Xcode writes on the build file: still there means a link it could not parse
    if (result.includes(`/* ${productName} in Frameworks */`)) {
        throw new Error(`removeSwiftPackageProduct: ${productName} is in project.pbxproj but its objects could not be parsed (unexpected formatting)`);
    }
    if (products.size === 0) return content;
    return crlf ? result.replace(/\n/g, '\r\n') : result;
}

// Removes the run script phase(s) named `name` (PBXShellScriptBuildPhase) and the list entries naming them; a
// phase it finds by name and cannot take out is an error
function removeRunScriptPhase(content, name) {
    const crlf = content.includes('\r\n');
    const lines = (crlf ? content.replace(/\r\n/g, '\n') : content).split('\n');
    const nameLine = `name = ${JSON.stringify(name)};`;
    const phases = parseObjects(lines).filter((object) => isa(object) === 'PBXShellScriptBuildPhase' && object.text.includes(nameLine));
    // One object per isa: a phase whose closing line is missing would swallow the next object
    if (phases.some((object) => (object.text.match(/\bisa = /g) || []).length !== 1)) {
        throw new Error(`removeRunScriptPhase: "${name}" could not be parsed (unexpected formatting)`);
    }
    const result = phases.length === 0 ? lines.join('\n') : removeObjects(lines, phases, new Set(phases.map((object) => object.id)));
    if (result.includes(nameLine) || result.includes(`/* ${name} */`)) {
        throw new Error(`removeRunScriptPhase: "${name}" is in project.pbxproj but could not be removed (unexpected formatting)`);
    }
    if (phases.length === 0) return content;
    return crlf ? result.replace(/\n/g, '\r\n') : result;
}

module.exports = { removeSwiftPackage, removeSwiftPackageProduct, removeRunScriptPhase, parseObjects, isa };
