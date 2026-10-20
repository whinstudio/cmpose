const fs = require('fs-extra');
const path = require('path');

// The generation record, and personal-data minimization in logs.

const RECORD_PATH = path.join('.cmpose', 'generation.json');

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Keeps an IPv4 address's /24 and an IPv6 address's /48 (not enough to identify a person, enough to roughly track abuse) */
function truncateIp(ip) {
    if (typeof ip !== 'string' || ip.length === 0) return 'unknown';
    if (IPV4.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0');
    if (!ip.includes(':')) return ip;
    // IPv4-embedded IPv6 (::ffff:192.0.2.4): truncate it like IPv4
    const embedded = ip.slice(ip.lastIndexOf(':') + 1);
    if (IPV4.test(embedded)) return truncateIp(embedded);
    // '::' expands to zero groups, then the first three groups (/48) are kept
    const [head, tail] = ip.split('::');
    const headGroups = head ? head.split(':') : [];
    const tailGroups = tail ? tail.split(':') : [];
    const groups = tail === undefined
        ? headGroups
        : [...headGroups, ...Array(Math.max(0, 8 - headGroups.length - tailGroups.length)).fill('0'), ...tailGroups];
    return `${groups.slice(0, 3).join(':')}::`;
}

/** An uploaded detekt.yml is not kept; only whether one was sent */
function sanitizeFeaturesConfig(featuresConfig) {
    if (!featuresConfig || typeof featuresConfig !== 'object') return null;
    const { detektYamlContent, ...rest } = featuresConfig;
    return { ...rest, customDetektYaml: typeof detektYamlContent === 'string' && detektYamlContent.trim().length > 0 };
}

/** The .cmpose/generation.json content written into the generated project (no personal data). backendRevision names
 * the generator (backend.revision); serverTemplate is the backend template server/ came from, null without one. */
function buildGenerationRecord({
    templateRef, templateCommit, backendRevision, templateType, ci, minSdk, iosVersion, features, featuresConfig,
    serverTemplate = null, now = new Date()
}) {
    return {
        generator: 'cmpose',
        generatedAt: now.toISOString(),
        template: { ref: templateRef || null, commit: templateCommit || null },
        backend: { revision: backendRevision || null },
        serverTemplate: serverTemplate
            ? { repo: serverTemplate.repo || null, ref: serverTemplate.ref || null, commit: serverTemplate.commit || null }
            : null,
        options: {
            templateType,
            ci: ci === true,
            minSdk,
            iosVersion,
            features: features || [],
            featuresConfig: sanitizeFeaturesConfig(featuresConfig)
        }
    };
}

async function writeGenerationRecord(projectPath, record) {
    await fs.outputFile(path.join(projectPath, RECORD_PATH), `${JSON.stringify(record, null, 2)}\n`);
}

module.exports = { RECORD_PATH, truncateIp, sanitizeFeaturesConfig, buildGenerationRecord, writeGenerationRecord };
