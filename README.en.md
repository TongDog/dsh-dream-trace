# Dreaming for DeepSeek Harness

[中文主页](README.md) · [中文使用说明](README.zh-CN.md)

**Codex support:** [Dream Trace](codex-plugin/README.md) is a standalone Codex plugin using hooks for evidence capture and MCP for recall, consolidation and rollback. It shares the memory core and does not require Harness. Build its standalone archive with `npm run pack:codex`.

An independent project-memory plugin for **DeepSeek Harness 0.2.2-rc.1**, requiring **Node.js >=24.9.0**. Consolidates completed conversations into evidence-linked observations, corrects outdated notes, injects a bounded index into later sessions, and supports rollback. Version **0.2.0** adds a **Memory** page in the dsh Web sidebar for browsing and managing those records. It is not an official DeepSeek or Anthropic product.

[Install](#install-and-enable) · [Memory page](#memory-page) · [Operations](#operations) · [Architecture](#architecture) · [Configuration](#configuration) · [Development](#development-and-verification)

## Install and enable

Build and install a tarball from this repository:

```sh
npm ci
npm run check
npm pack
dsh plugin --profile web add /absolute/path/dsh-plugin-dreaming-0.3.1.tgz
```

The bundle starts with an empty allowlist. Create a workspace overlay `dreaming.patch.yml`:

```yaml
- id: dsh-plugin-dreaming
  config:
    projectRoots: [/absolute/path/to/project]
    storageDirectory: /absolute/path/to/dreaming-data
    provider: deepseek-official
    model: deepseek-flash
    autoRunAfterTurn: false
    afterTurnDelaySeconds: 30
    autoRunIntervalMinutes: 0
    verify: true
```

```sh
dsh web --patch /absolute/path/to/dreaming.patch.yml
```

Replace the archive path with the file produced by `npm pack`. These commands use the existing `web` profile; if you choose another profile, install and launch with that same profile. Restart dsh after replacing installed code and reload the browser to load the new client bundle. Configure credentials through dsh, not this plugin. Model routing must match an installed provider. The optional in-Harness `plugin_manager` can install a workspace bundle using its supported `install_bundle` workflow. The plugin itself never rewrites profile files.

## Memory page

Open **Memory** in the dsh Web sidebar, then select an enabled project. The page uses the same stored memories and operations as the agent tools.

- The four counters show active memories, supported memories, uncertain memories (**Needs review**), and the current revision. Active includes supported and uncertain records, excluding retired ones.
- Search titles, contents, and source quotations. Filter by procedure, decision, preference, fact, or pitfall, and by active, supported, uncertain, or retired status. The default view excludes retired records; select **Retired** or **All statuses** to inspect them.
- Select a record to read its full content, creation/update times, evidence quotations, source kind, observation time, session ID, and event sequence. These identifiers locate the original evidence; the page does not open the original conversation automatically.
- Toggle **Allow agent recall** in the detail pane. Paused records remain available under **Paused only**. Pausing a shared record at its source affects all receiving projects. A receiving project can also pause its own copy.
- Use **Run Dreaming** after completing work in the selected project. The page shows the operation result and reloads the current revision. **Refresh** fetches a fresh snapshot, including changes made through tools or background runs.
- **Remove memory** asks for confirmation before removing a current record. **Version history → Restore** asks for confirmation and restores the selected facts and processing cursors as a new revision. Both actions retain older revisions and source conversations.

An empty project list means `projectRoots` has not been configured. An enabled project with no records needs a completed conversation followed by a Dreaming run. The page displays operation failures without claiming that an update succeeded. Memory text is rendered as text, not executable markup.

The Web management API is restricted to the authenticated Harness owner; shared-session guests cannot enumerate projects or read or change memory through it. Project selection is limited to exact configured roots. The Web bridge is optional: headless and terminal profiles retain the same seven tools and background processing without a sidebar or API gateway.

## Operations

| Tool | Purpose |
|---|---|
| `dream_run` | Consolidate a bounded batch of completed turns for the caller's project |
| `dream_status` | Inspect memory version, recent error, active run and rollback revisions |
| `memory_search` | Literal keyword and Chinese substring search with citations |
| `memory_read` | Read one observation, status and original evidence |
| `memory_set_level` | Set L1–L5 in the source project. Sharing at L1 requires the current source revision. |
| `memory_forget` | Remove a current observation while retaining historical versions |
| `dream_rollback` | Restore facts and processing cursors as a new revision |

Finish a conversation turn before asking the agent to run `dream_run`; its currently open turn is excluded. `deferred: true` means the collector found more completed turns beyond this batch's budget; run again manually or wait for another automatic trigger. Automatic consolidation can run after a debounce following turn completion, or periodically using `autoRunIntervalMinutes`. Both are off by default. Timers require a running Host; persisted cursors let a later run resume work, but missed timer occurrences are not replayed.

`unchanged: true` means no new prefix was processed, no model was called, and no revision was created. A successful run with `unchanged: false` and zero created/updated/retired memories can still publish a revision that advances only the cursors. `running` and `lastRun` describe this Host process; they reset on restart, unlike memories, cursors, and revision history.

## Architecture

The plugin separates a **dsh adapter layer**, a **memory core**, and an **optional Web client**. All entry points delegate to `DreamingService`. The core has no dsh service dependency: the engine receives a `Generate` callback, which the Host implements using an isolated Agent session. DSH owns source logs, model execution, and prompt assembly; the plugin owns derived memory revisions. The [main README](README.md#整体架构) includes the architecture and recall diagrams.

| Module | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Project scope, shared operations, triggers, context registration, timeouts, and lifecycle cleanup |
| [src/config.ts](src/config.ts) | Loader-facing configuration and strict runtime validation |
| [src/transcripts.ts](src/transcripts.ts) | Complete-turn selection, incremental cursors, project isolation, and evidence filtering |
| [src/core/engine.ts](src/core/engine.ts) | Input budgeting, extraction proposals, citation validation, semantic review, and changes |
| [src/worker.ts](src/worker.ts) | A single-response, tool-free Agent session with durable input/output logs |
| [src/core/store.ts](src/core/store.ts) | Cross-process writer locks, checksummed revisions, atomic publication, and recovery |
| [src/core/index.ts](src/core/index.ts) | Keyword search, record lookup, and bounded index rendering |
| [src/tools.ts](src/tools.ts) | Seven agent tools scoped to the caller's current project |
| [src/ui-bridge.ts](src/ui-bridge.ts) / [src/ui-protocol.ts](src/ui-protocol.ts) | Optional owner-only Remote service and shared strict request/result codecs |
| [client/source.js](client/source.js) / [locale/](locale/) | React panel, snapshot filtering, evidence details, and bilingual labels |

The Web client uses dsh's existing typed Remote transport, with no separate HTTP server. The bridge registers only when `typert` is available. Agent tools infer the project from the calling session; Web requests must select an exact configured root.

Writes have two guards: service-level exclusion for `run`, `forget`, and `rollback`, followed by a cross-process store lock. Extraction and review hold that lock so proposals use the current locked revision. Overlapping manual writes receive `BUSY`; automatic triggers skip a busy project. Reads can still access the published snapshot. Unloading cancels workers and timers, waits for active operations, and retains stored data.

## Processing and storage

The plugin reads original DSH events, removes inherited fork history and injected context, excludes subagent/worker sessions and its own tool output, redacts recognizable credentials, and supplies bounded evidence to a model-only worker. Workers use the production Agent loop, retain replayable inputs and outputs, have no executable tools even under a PTC caller, and use ordinary DSH event types. Exact source quotes are checked before a separate semantic review. Only a successful run atomically publishes both memory and processing cursors.

Each canonical project has its own directory under `storageDirectory`, identified by a SHA-256 hash of its path. Immutable JSON revisions and a checksummed current pointer support recovery; a cross-process writer lock prevents concurrent overwrites. Sources record session id, event sequence, original quote, source kind and observation time. At `agent/pre-step`, the service reads the latest snapshot and contributes a bounded index through `systemPrompt.context`. The logged index prioritizes short supported conclusions for L1 (explicitly shared defaults), L2 (project settings/preferences) and L3 (critical lessons). L4 shows titles, L5 is retrieved on demand. Existing records default to L4. The Memory page lets you filter and change levels. All enabled projects can recall L1 conclusions, while source quotes remain in the originating project. No secondary Markdown copy or Wiki is maintained in this version.

Forgetting preserves processing cursors; rollback restores the selected revision's facts and cursors as a new revision, so later history may be processed again. `COMMIT_UNKNOWN` means publication may have succeeded before a durability or cleanup failure. Refresh the snapshot or call `dream_status` before deciding to retry. The same state check is appropriate after an interrupted write response.

`supported` means that cited observations support a bounded claim, not universal truth. Assistant-only assertions stay `uncertain`; `stale` facts are excluded from tool search and the injected index, but remain inspectable through the Memory page's **Retired** filter. Model-generated memory remains fallible. The optional reviewer reduces unsupported updates but is not a correctness guarantee.

## Configuration

The complete table and examples are in the [Chinese guide](README.zh-CN.md#配置); the authoritative validation lives in `src/config.ts`. Defaults: 10 selected sessions, 2,000 evidence events, 60,000 input-data characters, 12,000 proposal characters, 100 current facts, 1,800 characters per fact, 20 changes per run, a 4,000-character index, 6,000 output tokens per worker and a 180-second run timeout. `maxInputChars` bounds JSON payloads, not tokens or fixed system/context overhead. Budget allocation reserves room for the review proposal. A whole turn that cannot fit fails visibly without dropping text or advancing its cursor.

Allowlisted roots must exist, be directories and not overlap. Only conversations created inside a root are read; turns crossing outside it are excluded as a whole. Moving a project requires explicit reconfiguration. Tool calls cannot select another project. Full-log query reads still have a cost even when only a new suffix is processed.

`memory_forget` is not secure erasure: older revisions and original/worker transcripts retain history. Revisions are not automatically pruned. Pattern-based redaction cannot recognize every secret. Enabling a project allows selected history to be sent to the configured provider.

## Development and verification

```sh
npm ci
npm run check
node scripts/verify-package.mjs
```

`npm run check` runs type checking, tests, and the build; the package verification script is a separate check. The build emits Host ESM code and declarations into `lib/`, then bundles `client/source.js`, locale dictionaries, and strict Remote codecs into the distributed `client.js` with esbuild. Edit `client/source.js` and rebuild to change the panel. React comes from dsh's browser module table.

Tests cover evidence validation, correction, rollback, cancellation, concurrent writers, project isolation, real DSH sessions, durable recall, tool schemas, optional Web Remote access, and unload cleanup. Scripted adapters exercise the actual DSH loop without online credentials. They establish implementation behavior, not live-model memory quality or browser rendering. See [compatibility requirements](docs/compatibility.md) and the [verification record](docs/verification.md) for the checks actually completed.
