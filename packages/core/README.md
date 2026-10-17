# @cmpose/core

The cmpose generator library: it turns the pinned Compose Multiplatform template into a new project (validation, package and name rewrites, optional features and modules). See the README at the root of the cmpose repository for usage and development.

It also generates Unity mobile games from the pinned game template: `game.validateGame`, `game.generateGame` and `game.describeGame` (`describeGame({ themes: await game.readThemes(templateDir) })` adds the template's theme families).
