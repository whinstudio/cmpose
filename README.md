# cmpose

Generate Compose Multiplatform projects on your own machine — from any AI agent, through MCP.

Ask your agent for an app ("a blank Compose Multiplatform app called Habits with Room and
theming") and get a buildable Android + iOS project from a tested template: Koin, Navigation,
Ktor, Room, DataStore, theming, multi-language, RevenueCat purchases, AdMob ads, detekt,
backend (Ktor server, Firebase sign-in, sharing; blank only; turns on multi-language and
networking) and CI as options. What each option adds: [packages/mcp/README.md](packages/mcp/README.md).

It also generates Unity mobile games ("a 2D Unity game called SkyHopper with ads and
leaderboards"): a Unity 6 (URP) Android + iOS project from the pinned game template
(`whinstudio/cmpose-game-template`), as a `showcase` sample game (2D runner or 3D track) or a
`blank` game with flags for saving, theming, multi-language, networking, RevenueCat purchases,
AdMob ads, Play Games / Game Center leaderboards and insights (Firebase Crashlytics + Analytics),
up to 3 feature modules and your real IDs.

And it generates a standalone Kotlin/Ktor backend ("a backend called NotesBackend with
sharing"): Firebase sign-in verified on the server, PostgreSQL with Flyway, file uploads, a
sample feature to copy and the parts to deploy it as one Docker container, from the pinned
backend template (`whinstudio/cmpose-backend-template`), with an optional `sharing` part
(spaces, roles and invitations).

- `@cmpose/core` — the generator library.
- `@cmpose/mcp` — a local stdio MCP server with six tools: `cmp_describe`, `cmp_generate`,
  `game_describe`, `game_generate`, `backend_describe` and `backend_generate`.

Requires Node.js 20+ and git. The first generation downloads the pinned template
(`whinstudio/cmpose-template`) into `$XDG_CACHE_HOME/cmpose` when `XDG_CACHE_HOME` is set, else
`~/.cache/cmpose` (override: `CMPOSE_CACHE_DIR`).

Developer guide (architecture, modules, backend, release): https://whinstudio.github.io/cmpose/guide.html

## Use with Claude Code

    claude mcp add -s user cmpose -- npx -y @cmpose/mcp

`-s user` makes the server available in every directory; without it, it is added only for the
directory you run the command in.

Optional skills for Claude Code live in [whinstudio/skills](https://github.com/whinstudio/skills):
`cmp-new-project` generates a project through this server asking only four questions, and
`cmp-feature`, `cmp-code-rules`, `cmp-testing` and others help when working in a generated
project. Install one into `~/.claude/skills/`:

    git clone https://github.com/whinstudio/skills.git
    ln -s "$PWD/skills/cmp-new-project" ~/.claude/skills/cmp-new-project

## Use with other MCP clients

Add the server to the client's `mcpServers` configuration:

```json
{
  "mcpServers": {
    "cmpose": {
      "command": "npx",
      "args": ["-y", "@cmpose/mcp"]
    }
  }
}
```

`cmp_generate` takes `projectName`, `appName`, `packageName` and an absolute `outputDir`
(required), plus optional `templateType` (`showcase` | `blank`), `features`, `featuresConfig`
(blank only), `minSdk`, `iosVersion`, `ci`, `templateRef` and `backendTemplateRef` (the
backend template tag that `server/` comes from; blank with the backend only); `cmp_describe`
lists the defaults and rules. `game_generate` takes the same required fields plus optional
`companyName`, `templateType`, `render` (`2d` | `3d`), `flags` and `features` (blank only),
`minSdk`, `iosVersion`, `ids`, `theme` and `templateRef`; `game_describe` lists the flags, ID
groups, limits and the template's theme families.
`backend_generate` takes the same required fields (`appName` is the service name, e.g.
`notes-api`) plus optional `sharing`, `sample` (the sample items feature, default on) and
`templateRef`; `backend_describe` lists the rules and the conventions an agent follows when it
adds code to the generated backend.

## Compatibility

From 1.0.0 the MCP tools follow semantic versioning. The current major is 2.x (2.0.0 removed the
game `uiTheme` flag). Each `@cmpose/mcp` release depends on the `@cmpose/core` release of the same
version and pins one tag of each template, so a given version always generates the same project.

- **Stable in 2.x:** the six tool names; every input field above, its accepted values and its
  default (the `featuresConfig` keys, the game `flags`, the backend options); the fields of each
  tool's structured result.
- **A 2.x release may:** add optional fields, flags or values; accept input an earlier release
  refused; add warnings; move the pinned templates to newer tags (the release notes say what the
  generated projects gain).
- **Needs 3.0:** renaming or removing a field, flag or value; refusing input a 2.x release
  accepted; changing a default.
- **Not covered:** the contents of the generated projects (they follow the pinned templates),
  the text of warnings and errors, and `templateRef` / `backendTemplateRef` pointing at a tag
  other than the pinned one (accepted as is; an older tag may lack newer options).

## Develop

    npm install
    npm test
    npm run scan    # public hygiene scan: private paths, names, addresses, secrets

The 5 real-template tests in `packages/core/test/fileService.importSort.test.js` run only
when `CMP_REAL_TEMPLATE_DIR` points to a checkout of the template, e.g.
`CMP_REAL_TEMPLATE_DIR=/path/to/template-checkout npm test`; otherwise they are skipped.

`CMPOSE_BACKEND_TEMPLATE_DIR` points to a checkout of the backend template (an absolute path).
The MCP server then generates from that checkout instead of the pinned tag: `backend_generate`
and the `server/` of a `cmp_generate` blank project with the backend. Only git's tracked files
are copied, and the result warns that it is not a released tag. The real backend-template tests
in `packages/core/test/backend-generate.real.test.js` (and, together with `CMP_REAL_TEMPLATE_DIR`,
in `generate.backend.real.test.js`) run only when it is set, e.g.
`CMP_REAL_TEMPLATE_DIR=/path/to/template-checkout CMPOSE_BACKEND_TEMPLATE_DIR=/path/to/backend-template-checkout npm test`.
