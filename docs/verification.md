# Verification record

Version **0.2.0** was verified on 2026-11-08 with Node.js **26.9.0**, TypeScript **5.9.x**, Cordis **4.1.0** and published DeepSeek Harness packages **0.2.2-rc.1**. Platform: macOS. The repository was checked against the official plugin development skill, bundle publication guide, public service types and actual published runtime packages.

## Completed checks (0.2.0)

| Check | Result |
|---|---|
| `npm run typecheck` | Passed, strict TypeScript, including tests |
| `npm test` | **55 passed; 0 failed; 0 skipped** |
| `npm run build` | Passed; built Host ESM JavaScript, declarations, and the esbuild Client bundle |
| `npm run check` | Passed; type checking, tests, and build |
| `node scripts/verify-package.mjs` | Passed; 48 tarball files, metadata, icon, bundle patch, ESM import, configuration schema, actual Client lazy factory and bilingual UI resources |
| Official `dsh plugin --profile dreaming-ui add <tarball>` | Succeeded in an isolated temporary DSH home |
| Actual dsh Web with the installed tarball | Loaded the Memory sidebar page and completed the browser checks below |
| `git diff --check` | Passed |

The original 0.1.0 distribution smoke also used the official launcher to verify composed configuration, plugin activation, all six tools, revision 0, and an empty-history run without model calls. Its installer reported missing peers in the isolated profile's pnpm tree. DSH supplies the shared runtime peers through its installation, as documented by its third-party plugin resolution rules; that official profile boot succeeded without an unresolved-runtime-dependency error.

## What the tests establish

- **4 configuration tests:** inert defaults, valid absolute paths, unknown-field rejection, bounded limits and proposal/input budget consistency.
- **24 core tests:** exact evidence matching, independent review rejection, correction/retirement, historic evidence merging, observation time and source kind, assistant-only uncertainty, credential patterns, cursor idempotence, arbitrary session identifiers, budget allocation, rollback, forgetting, checksum chains, cancellation, concurrent writers, lost/replaced writer locks, failed publication, and acceptance of an omitted empty retirement list while preserving strict update and evidence validation.
- **14 transcript tests:** real DSH event validation, complete-turn selection, no silent truncation, project and symlink isolation, working-directory changes, fork inheritance, interrupted synthetic closers, injected-context exclusions, own-tool exclusions, cancellation and cursor validation.
- **8 integration tests:** production DSH Agent loop, durable worker sessions, later-session memory context, project isolation, all six tools through the actual registry, invalid tool arguments, cancellation and retry, active-worker disposal, delayed-task cleanup, successful automatic consolidation, and PTC caller/worker executor isolation.
- **5 Web integration tests:** official Client/Host gateway operations, exact scoped snapshots and source evidence, guest and malformed-request rejection, shared UI/tool read/write behavior, Remote cleanup on unload, and activation of the actual Client factory under a plugin fiber with its declared dynamic namespace access.

The distribution smoke used the official `dsh` launcher and a packed install, not just a source import. It did not modify any existing user profile. Source-level integration tests additionally run extraction and semantic review through a scripted adapter in the real Agent loop and read the persisted worker logs back through `sessionQuery`.

## Web memory page verification (0.2.0)

Version 0.2.0 adds the bundled `client.js`, English/Chinese sidebar page, strict shared Remote protocol, and optional owner-only Host bridge. The installed package was exercised in the actual dsh Web application, using disposable fixture projects and memories.

Completed browser checks:

- Opened **Memory / 记忆** from the sidebar and switched projects, including a project with no memories.
- Checked displayed counters, search, retired-status filtering, and evidence details with the exact fixture session identifier `demo-conversation` and event sequence.
- Cancelled a removal, then confirmed it: the active count changed from 4 to 3 and the current revision became 3.
- Restored revision 2 after confirmation: the active count returned to 4 and the operation created revision 4.
- Ran **Run Dreaming** successfully with no new source history; it completed without an online model call.
- Inspected the rendered page in light and dark themes at a wide viewport; switched the running UI between Chinese and English and verified translated labels.
- Verified no-match and empty-version states, and that filtered results select the matching detail instead of retaining an unrelated note.

The browser run exposed a Client factory activation bug that was fixed and covered by an additional lifecycle regression test. Gateway tests independently verify owner-only access, exact configured-root selection, strict request validation, shared service behavior, and unload cleanup. These checks used an isolated profile and did not modify an existing user profile.

## Live model smoke test

A real `deepseek-official` / `deepseek-flash` run used a synthetic project instruction about a test command, a configuration path, and a preference for brief Chinese explanations. It did not send existing user conversations. Extraction and independent semantic review both completed, one supported memory with the original quotation and event reference was persisted as revision 1, and a repeated run kept revision 1 with no additional model calls.

The actual running Web page subsequently displayed that persisted memory after switching to the test project: one active, supported record at revision 1, its generated title and content, and the verbatim evidence from session `synthetic-dreaming-smoke-2026-11-08T04-09-01-577Z`, event **#5**. Viewing it made no further model calls.

The successful run began at **2026-11-08 12:09:01 Asia/Shanghai (UTC+08:00)**. An earlier attempt at **12:06:45 Asia/Shanghai (UTC+08:00)** made one paid extraction call but failed proposal validation because the model omitted the empty retirement list. The parser now defaults only that missing list to an empty array; update, evidence, and review validation remain strict. A regression test covers the change.

| Attempt | Paid calls | Uncached input tokens | Cached input tokens | Output tokens | Result |
|---|---:|---:|---:|---:|---|
| Earlier extraction | 1 | 583 | 0 | 200 | Rejected before publication |
| Successful extraction and review | 2 | 1,047 | 128 | 233 | One memory persisted as revision 1 |
| Repeat of successful run | 0 | 0 | 0 | 0 | Unchanged; no new source events |
| Total | **3** | **1,630** | **128** | **433** | |

The [official Flash pricing page](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/) checked on 2026-11-08 lists off-peak prices of CNY 1 per million uncached input tokens, CNY 0.02 per million cached input tokens, and CNY 4 per million output tokens; peak prices are twice those amounts. Applying these rates to all three calls gives an off-peak estimate of **CNY 0.00336456**, or a conservative peak-rate estimate of **CNY 0.00672912**—less than CNY 0.01. These are usage-based estimates; no billed balance or account statement was read.

The API credential was supplied only through the process environment. Exact-match scans found no copy in source files, deliverables, or live-test files. The Web test server was not given that credential.

## Limits of this evidence

The paid run establishes that extraction, semantic review, evidence preservation, publication, and idempotent reprocessing work with a live model on one synthetic instruction. It is not a memory-quality benchmark. Scripted responses establish lifecycle, logging, validation and storage behavior; accuracy, correction quality, and usefulness across real project histories still require representative evaluation. The plugin is version-pinned because DSH's pre-stable APIs can change.

Plugin Manager metadata, the SVG resource, and both locale dictionaries were validated in the built package. The rendered Plugin Manager appearance was not inspected in a browser. The Memory page was checked at a wide viewport; mobile layouts and a complete browser pass in both locales were not established by this run. The successful no-op browser run establishes UI-to-Host operation, not live-model extraction quality.

Windows and other Node versions were not executed locally. JSON revision and pointer files are fsynced; POSIX additionally fsyncs their containing directory. Windows lacks the same directory-fsync operation through Node. Filesystem or lock-release failures after pointer publication are reported as `COMMIT_UNKNOWN`; re-read current state before deciding to retry.
