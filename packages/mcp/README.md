# @cmpose/mcp

Ask your AI agent for a **Compose Multiplatform** app and get a real, buildable Android + iOS
project on disk, generated locally from a tested template. It also generates **Unity** mobile
games (Android + iOS) and standalone **Kotlin/Ktor backends**. This is a local stdio MCP
server with six tools: `cmp_describe`, `cmp_generate`, `game_describe`, `game_generate`,
`backend_describe` and `backend_generate`. It runs on your machine, with no account, no API key
and no upload.

> "Create a blank Compose Multiplatform app called Habits, package com.acme.habits, in
> ~/Projects, with Room, light/dark theming and AdMob ads."

Developer guide for generated projects: https://whinstudio.github.io/cmpose/guide.html

## Install

Requires Node.js 20+ and git.

**Claude Code**

    claude mcp add -s user cmpose -- npx -y @cmpose/mcp

**Claude Desktop, Cursor, Windsurf and other MCP clients** (`mcpServers` config):

```json
{
  "mcpServers": {
    "cmpose": { "command": "npx", "args": ["-y", "@cmpose/mcp"] }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "cmpose": { "type": "stdio", "command": "npx", "args": ["-y", "@cmpose/mcp"] }
  }
}
```

## What you get

Every project has `androidApp`, `iosApp` (Xcode project), a `shared` module with Koin and
Navigation, logging (Kermit), image loading (Coil), in-app review, update check, an About
screen, a `build-logic` with convention plugins, and a README with a release checklist.

- **Template:** `showcase` (home, onboarding and paywall demo screens) or `blank`
  (a clean shell with a sample feature).
- **Options for `blank`:** Ktor networking (with an optional in-app network inspector),
  theming (light/dark/system), multi-language strings, DataStore, Room (KMP, bundled SQLite),
  RevenueCat purchases with a custom Compose paywall, AdMob ads with UMP/ATT consent, detekt,
  backend (Ktor server, Firebase sign-in, sharing; blank only; turns on multi-language and
  networking).
- **Your own feature modules:** up to 3, each with contract/data/domain/presentation layers.
- **CI:** an optional GitHub Actions workflow.
- **Your names everywhere:** package, bundle id, app name, min SDK and iOS deployment target.

## Games (Unity)

> "Create a 2D Unity game called SkyHopper, package com.acme.skyhopper, in ~/Projects, blank,
> with ads and leaderboards"

Every game project is a Unity 6 project (editor 6000.3.25f1, URP) for Android and iOS, with
VContainer + UniTask, a uGUI interface, a Boot → Menu → Game scene flow, a settings screen,
saving, deep links, and in-app review and update check.

- **Template:** `showcase` (a sample game with every flag on: a 2D runner, or a 3D track with
  `render: "3d"`) or `blank` (an empty game with the flags you pick). `render` is `2d`
  (default) or `3d`.
- **Flags for `blank`:** `saveSystem`, `uiTheme`, `multiLang`, `network`, `networkInspector`
  (needs `network`, added for you), `purchases` (RevenueCat), `ads` (AdMob) and
  `leaderboards` (Google Play Games and Game Center).
- **Your own feature modules (`blank`):** up to 3.
- **IDs:** `ids` takes your real AdMob (`admob`), RevenueCat (`revenueCat`) and Play Games +
  Game Center (`gameServices`) IDs, each group with its flag; `game_describe` lists the fields.
  A group you leave out keeps the test IDs / placeholders and is reported as a warning.
- **Look (`theme`):** one of the template's style families (`bright`, `neon`, `pastel`, `bold`,
  `nature`, `clean`; palette, shapes, motion and a font pair), listed by `game_describe` under
  `themes` with what each suits. `theme: { family, primary, accent, fontPair }`, every field
  optional: `primary` and `accent` (`#RRGGBB`) recolour the family with their lightness shifted
  until text and buttons keep their contrast; a colour that still cannot pass keeps the
  family's and is reported as a warning. Without `theme` the project gets `clean`, exactly as
  the template ships it.
- **Your names everywhere:** package (application identifier), company name, app name, min SDK
  (25 to 36) and iOS deployment target (15.0 to 26.2).

> "Create a backend called NotesBackend, service name notes-api, package com.acme.notes, in
> ~/Projects, with sharing"

Every backend is a Kotlin (JVM 21) Ktor server with PostgreSQL (Exposed, Flyway), Firebase ID
tokens verified on the server (no Admin SDK), file uploads, account deletion, one sample feature
to copy, a security checklist, a local runner (`./gradlew runLocal`) and the parts to deploy it
as one Docker container behind nginx. `sharing` adds spaces, roles and invitations.

## Tools

- `cmp_describe`: the defaults, the options and the rules (name formats, limits, which option
  needs which). Agents call it first.
- `cmp_generate`: creates the project. Required: `projectName` (letters only, up to 30),
  `appName` (up to 30 characters), `packageName` (e.g. `com.acme.habits`, up to 50 characters)
  and an absolute `outputDir`. Optional: `templateType`, `features` (module names up to 20),
  `featuresConfig`, `minSdk` (24 to 36), `iosVersion` (15.0 to 26.2), `ci`, `templateRef`,
  `backendTemplateRef` (the backend template tag that `server/` comes from; blank with the
  backend only).
  It returns the project path, the template version it used, warnings (e.g. test ad IDs to
  replace) and next steps.
- `game_describe`: the Unity game generator's engine and editor version, template types,
  renders, flags and their dependencies, ID groups, defaults, limits and the pinned template's
  theme families (`themes`: `default` and each family's `id`, `title`, `suits` and `fontPairs`;
  the first call downloads the template). Agents call it first.
- `game_generate`: creates the game. Required: `projectName` (1 to 30 letters or digits,
  starting with a letter), `appName` (up to 30 characters), `packageName` (e.g.
  `com.acme.skyhopper`, at least 3 segments, up to 50 characters) and an absolute `outputDir`.
  Optional: `companyName` (like `projectName`; by default the package's second segment,
  capitalized), `templateType`, `render`, `flags`, `features` (module names: 1 to 20 lowercase
  letters or digits, starting with a letter), `minSdk` (25 to 36), `iosVersion` (15.0 to 26.2,
  written as `major.minor`), `ids`, `theme`, `templateRef`. It never overwrites a non-empty
  folder. The result names the applied theme (`theme`) and lists colour fallbacks among the
  warnings.
- `backend_describe`: the backend generator's options, `appName` rules, the project anatomy and
  the conventions to follow when adding code (protected routes, the 404 rule, where features
  go, the security checklist, the quotas, the local runner and the deploy parts). Agents call it first.
- `backend_generate`: creates the backend. Required: `projectName` (letters only, up to 30),
  `appName` (the service name: 2 to 31 lowercase letters, digits or `-`, starting with a letter;
  not `api`, `health`, `admin` or `static`), `packageName` (e.g. `com.acme.notes`) and an
  absolute `outputDir`. Optional: `sharing` (default `false`), `sample` (the sample items
  feature, default `true`), `templateRef`. It never overwrites a non-empty folder.
  `CMPOSE_BACKEND_TEMPLATE_DIR` (the absolute path of a backend template checkout) generates
  from that checkout instead of the pinned tag.

## How it works

Generation runs entirely on your machine. The first call downloads the pinned template
([whinstudio/cmpose-template](https://github.com/whinstudio/cmpose-template)) into
`~/.cache/cmpose` (override with `CMPOSE_CACHE_DIR`), and later calls reuse it. Games come the
same way from the pinned game template
([whinstudio/cmpose-game-template](https://github.com/whinstudio/cmpose-game-template)); Unity
never runs during generation. Backends come from the pinned backend template
(`whinstudio/cmpose-backend-template`). Each release pins one tag of each template, so `@cmpose/mcp@x.y.z`
always generates the same project.

Source and issues: [github.com/whinstudio/cmpose](https://github.com/whinstudio/cmpose).
MIT licensed. The projects you generate are yours.
