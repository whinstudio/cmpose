#!/usr/bin/env node
'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const core = require('@cmpose/core');
const pkg = require('../package.json');
const { describe } = require('./describe');
const { runGenerate } = require('./generate');
const { runGameGenerate, runGameDescribe } = require('./gameGenerate');
const { runBackendGenerate } = require('./backendGenerate');

const GENERATE_DESCRIPTION = 'Generate a Compose Multiplatform (Android + iOS) project on this machine. ' +
    'Call cmp_describe first for the options, defaults and validation rules. ' +
    'Writes <outputDir>/<projectName>; never overwrites an existing non-empty folder.';

const GAME_GENERATE_DESCRIPTION = 'Generate a Unity 6 (Android + iOS) mobile game project on this machine. ' +
    'Call game_describe first for the flags, defaults and validation rules. ' +
    'showcase has every flag on; flags and features apply to blank only. ' +
    'theme picks one of the style families game_describe lists under themes (palette, shapes, motion, fonts; ' +
    'match the family whose suits fits the game) and optionally a fontPair of that family. primary and accent ' +
    '(#RRGGBB) recolour the family: their lightness is shifted until text and buttons keep their contrast, and a ' +
    'colour that still cannot pass falls back to the family default with a warning. Without theme the template ' +
    'default family (clean) is used. ' +
    'Writes <outputDir>/<projectName>; never overwrites an existing non-empty folder.';

const BACKEND_GENERATE_DESCRIPTION = 'Generate a standalone Kotlin/Ktor backend (Docker-ready) on this machine. ' +
    'Call backend_describe first. ' +
    'Writes <outputDir>/<projectName>; never overwrites an existing non-empty folder.';

// MCP progress notifications for a tool call that sent a progress token
function progressReporter(extra, total) {
    const progressToken = extra && extra._meta && extra._meta.progressToken;
    let step = 0;
    return (message) => {
        if (progressToken === undefined) return;
        step += 1;
        extra.sendNotification({
            method: 'notifications/progress',
            params: { progressToken, progress: step, total, message }
        }).catch(() => { });
    };
}

// backendTemplateDir: a local backend template checkout used instead of the template cache (CMPOSE_BACKEND_TEMPLATE_DIR)
function createServer({ cacheDir, remoteUrl, backendTemplateDir = process.env.CMPOSE_BACKEND_TEMPLATE_DIR || null } = {}) {
    const server = new McpServer({ name: 'cmpose', version: pkg.version });

    server.registerTool('cmp_describe', {
        description: 'Describe the cmpose generator: template types, featuresConfig flags and defaults, dependency rules, validation limits and the pinned template.',
        inputSchema: {}
    }, async () => {
        const facts = describe();
        return { content: [{ type: 'text', text: JSON.stringify(facts, null, 2) }], structuredContent: facts };
    });

    server.registerTool('cmp_generate', {
        description: GENERATE_DESCRIPTION,
        inputSchema: {
            projectName: z.string().describe('Letters only, no spaces (e.g. MyApp)'),
            appName: z.string().describe('Display name (e.g. My App)'),
            packageName: z.string().describe('Reverse-domain package (e.g. com.example.myapp)'),
            outputDir: z.string().describe('Absolute path of the folder to create the project in'),
            templateType: z.enum(['showcase', 'blank']).optional(),
            features: z.array(z.string()).optional().describe('Extra feature modules (lower case names)'),
            featuresConfig: z.record(z.string(), z.any()).optional()
                .describe('blank only: flags from cmp_describe (unknown keys are refused; ignored for showcase)'),
            minSdk: z.union([z.string(), z.number()]).optional().describe('Android min SDK, e.g. "24" or 24'),
            iosVersion: z.union([z.string(), z.number()]).optional().describe('iOS deployment target, e.g. "15.0"'),
            ci: z.boolean().optional(),
            templateRef: z.string().optional().describe('Override the pinned template tag')
        }
    }, async (args, extra) => runGenerate(args, {
        cacheDir, remoteUrl, onProgress: progressReporter(extra, 2), generatorVersion: `mcp@${pkg.version}`
    }));

    server.registerTool('game_describe', {
        description: 'Describe the Unity game generator: engine and editor version, template types, renders, flags and their dependencies, ID groups, defaults, validation limits, the pinned game template and its theme families (themes: default, and each family\'s id, title, suits and fontPairs).',
        inputSchema: {}
    }, async () => runGameDescribe({ cacheDir, remoteUrl }));

    server.registerTool('game_generate', {
        description: GAME_GENERATE_DESCRIPTION,
        inputSchema: {
            projectName: z.string().describe('Letters or digits, starting with a letter, no spaces (e.g. SkyHopper)'),
            appName: z.string().describe('Display name (e.g. Sky Hopper)'),
            packageName: z.string().describe('Reverse-domain application identifier (e.g. com.example.skyhopper)'),
            outputDir: z.string().describe('Absolute path of the folder to create the project in'),
            companyName: z.string().optional().describe('Company name (defaults to the second packageName segment, capitalized)'),
            templateType: z.enum(['showcase', 'blank']).optional()
                .describe('showcase (default): the sample games with every flag on; blank: an empty game with the flags and features you pick'),
            render: z.enum(['2d', '3d']).optional().describe('Render setup (default 2d)'),
            flags: z.array(z.string()).optional()
                .describe('blank only: flags from game_describe (required flags are added); showcase has every flag on'),
            features: z.array(z.string()).optional().describe('blank only: extra feature modules (lower case names)'),
            minSdk: z.union([z.string(), z.number()]).optional().describe('Android min SDK, e.g. "25" or 25'),
            iosVersion: z.union([z.string(), z.number()]).optional().describe('iOS deployment target, e.g. "15.0"'),
            ids: z.record(z.string(), z.record(z.string(), z.string())).optional()
                .describe('Real IDs by group (admob, revenueCat, gameServices; fields in game_describe), each needing its flag. ' +
                    'A group left out keeps the test IDs / placeholders, reported as a warning'),
            // passthrough: unknown fields reach validateGame, which refuses them by name
            theme: z.object({
                family: z.string().optional().describe('A family id from game_describe themes.families (default: themes.default)'),
                primary: z.string().optional().describe('#RRGGBB primary colour; lightness is adjusted to keep contrast'),
                accent: z.string().optional().describe('#RRGGBB accent colour; lightness is adjusted to keep contrast'),
                fontPair: z.string().optional().describe("One of the family's fontPairs (default: its first)")
            }).passthrough().optional()
                .describe('Style family and optional colour shifts; without it the template default family is used'),
            templateRef: z.string().optional().describe('Override the pinned game template tag')
        }
    }, async (args, extra) => runGameGenerate(args, {
        cacheDir, remoteUrl, onProgress: progressReporter(extra, 2), generatorVersion: `mcp@${pkg.version}`
    }));

    server.registerTool('backend_describe', {
        description: 'Describe the Kotlin/Ktor backend generator: options, appName rules, the project anatomy, the pinned backend template ' +
            'and the conventions to follow when writing code in a generated backend.',
        inputSchema: {}
    }, async () => {
        const facts = core.backend.describeBackend();
        return { content: [{ type: 'text', text: JSON.stringify(facts, null, 2) }], structuredContent: facts };
    });

    server.registerTool('backend_generate', {
        description: BACKEND_GENERATE_DESCRIPTION,
        inputSchema: {
            projectName: z.string().describe('Letters only, no spaces (e.g. NotesBackend)'),
            appName: z.string().describe('Service name: 2-31 lowercase letters, digits or -, starting with a letter (e.g. notes-api)'),
            packageName: z.string().describe('Reverse-domain Kotlin package (e.g. com.example.notes)'),
            outputDir: z.string().describe('Absolute path of the folder to create the project in'),
            sharing: z.boolean().optional().describe('Spaces shared between users with roles and invitations (default false)'),
            sample: z.boolean().optional().describe('Include the sample items feature (default true)'),
            templateRef: z.string().optional().describe('Override the pinned backend template tag')
        }
    }, async (args, extra) => runBackendGenerate(args, {
        cacheDir, remoteUrl, templateDir: backendTemplateDir, onProgress: progressReporter(extra, 2), generatorVersion: `mcp@${pkg.version}`
    }));

    return server;
}

async function main() {
    // stdout carries JSON-RPC: every log line goes to stderr
    const toStderr = (...args) => console.error(...args);
    core.setLogger({ info: toStderr, warn: toStderr, error: toStderr });
    await createServer().connect(new StdioServerTransport());
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { createServer };
