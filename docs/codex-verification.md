# Codex Dream Trace verification

Scope: standalone `codex-plugin-dream-trace@0.1.0`, sharing the unchanged Dreaming core with the dsh plugin.

Environment: macOS arm64, Node.js 26.9.0, TypeScript 5.9.x, MCP TypeScript SDK 1.32.2, Codex Desktop CLI `0.164.0-alpha.11.1`.

## Checks

- `npm run check`: strict type checking, 73 tests (55 existing + 18 Codex tests), dsh build and standalone Codex bundle.
- `node scripts/verify-package.mjs`: existing dsh distribution, runtime peer imports and UI resources.
- `node scripts/verify-codex-package.mjs`: actual 11-file Codex tarball extracted outside the repository, without `node_modules`; real SDK stdio initialization and tool calls; Unicode hook capture; two scripted HTTP model requests for extraction/review; idempotent repeat; later-session index; scope denial; forgetting and rollback.
- The package verifier also installs the extracted plugin using the real `codex plugin marketplace add` and `codex plugin add` commands in a temporary `CODEX_HOME`. A real `codex app-server --stdio` then reports the plugin's Skill, five hooks and seven MCP tools, with a successful bundled-server handshake.
- `skill-creator/scripts/quick_validate.py`: bundled Skill frontmatter/name validation. PyYAML was installed only into a temporary validation directory.
- `git diff --check`: whitespace validation.

The Codex tests cover inert defaults, configuration validation, stopped/open segment boundaries, explicit scope changes and symlink escapes, originating-project binding, subagent exclusion, fork isolation, repeated delivery, continued and in-turn prompts, concurrent capture, oversized input exclusions, batch deferral, cursor validation, evidence preservation, semantic review rejection, cancellation, background backlog processing, MCP validation and model response failures.

## Packaging decisions established by host checks

This release uses `.codex-plugin/plugin.json` with explicit paths to `.mcp.json`, `hooks/hooks.json` and `skills/`. In `.mcp.json`, `cwd: "./"` is resolved relative to the installed plugin root, and Node receives the relative entry `./dist/cli.mjs`.

On the tested Codex build, a portable root `plugin.json` did not expose the bundled hooks through `plugin/read`, and `${CLAUDE_PLUGIN_ROOT}` in legacy MCP arguments did not expand. An installation command returning success did not detect either problem. The final verifier therefore asserts native hook discovery and actual MCP startup, not just archive contents and installation success. A future format migration must pass those same assertions.

The SDK is a root development dependency; its required runtime modules are bundled into the standalone plugin with license notices. None of the existing lockfile package versions were changed. The dsh package keeps its existing runtime dependencies and generated files.

## Limits

All new model tests used synthetic observations and scripted responses, including a loopback HTTP server. No existing user chats or real API credentials were read or sent, and no paid model call was made. These tests establish mechanics, not real-model memory quality or latency.

Hook handlers were exercised as actual bundled processes with documented inputs. Native Codex hook discovery was checked, but no hook trust was bypassed and no interactive desktop conversation was driven end to end. Users must review and trust the installed hooks normally.

Only observations delivered after hook enablement are collected. Raw Codex history is intentionally not parsed. Stop marks a captured segment boundary, not proven task completion. Some model assertions, unsupported tools, failed hooks, subagent events and pre-installation history remain outside the evidence set. The README describes the scope and retention boundaries.

Windows, Codex Cloud, public-directory submission and additional Codex versions were not exercised. The local marketplace and installer tests do not modify the user's active Codex configuration.
