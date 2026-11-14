# DeepSeek Harness compatibility

This standalone bundle, version **0.4.0**, targets **DeepSeek Harness 0.2.2-rc.1** and Node.js **24.9.0 or newer**. The exact prerelease is declared in `engines.dsh` and the DSH peer dependency versions. Compatibility with other DSH releases is not assumed: update the declarations only after running the consumer checks against that release.

## Package and activation

The bundle is an ESM package with a built JavaScript entry point and TypeScript declarations. `dsh.bundle.patch` points to `cordis.patch.yml`; that layer inserts one uniquely named Host plugin row, `dsh-plugin-dreaming`. The shipped empty `projectRoots` list does not authorize historical-session processing. Configure explicit project directories before using memory operations.

`dsh.client` declares the Web face and its activation dependencies: API remotes, locale, layout, and sidebar. The `./client` export resolves to the bundled `client.js`; it registers the **Memory** main panel and sidebar item through the existing slots. The browser obtains React from dsh's module table, uses Harness theme tokens, and registers English/Chinese UI dictionaries. `npm run build` compiles Host TypeScript and then uses esbuild to package the Client source, dictionaries, and live Remote codec functions.

The plugin exports the ordinary Cordis module protocol and a Schemastery `Config`. Shared Cordis and DSH services belong in both `peerDependencies` and `devDependencies`: the former allows the installed Host to share its service instances, while the latter supports type checking and standalone tests. Third-party utility dependencies remain ordinary dependencies.

English and Chinese `meta.title` and `meta.description` are exported through `./locale/*.json`. The original SVG artwork is exported as `./icon`, fits within the 256 KiB limit, and is covered by the repository's MIT license. The package file allowlist includes both built runtime faces, declarations, patch, locales, icon, documentation, and license.

## Optional Web integration

The Host bridge registers the `dreamingUi` namespace only when `typert` is available. Headless compositions without that service retain memory tools, background processing, and context injection. The browser contribution and Host invocation descriptors share strict request/result codecs. No extra HTTP endpoint or embedded HTML application is introduced.

Every Remote operation checks that the invocation principal is the Harness owner. Requests with a project parameter must name an exact configured root; the bridge neither resolves arbitrary paths supplied by a browser nor exposes project enumeration to shared-session guests. UI actions delegate to the same Dreaming service operations as model tools. The page adds explicit confirmation for record removal and version restoration. Remote or transport failure is shown as failure, followed by a state refresh because an interrupted response alone does not establish whether a write committed.

The snapshot includes retired records for visual inspection. The default page filter, model-facing search, and injected index exclude them. Browser search filters the selected project's loaded snapshot by title, content, and evidence quotation. No client-side copy becomes authoritative memory.

The Memory page also exposes an owner-only update check. It reads the installed version from the packaged manifest, tries public manifest feeds in order (GitHub Contents API, then raw.githubusercontent.com, then the npm registry once the package is published), and compares semantic versions without throwing on network failure. Results are cached for 30 minutes per Host process; a forced check bypasses the cache. Only the public manifest is fetched: no project, session, or memory data leaves the Host. The check never rewrites the installed dependency. A pinned GitHub commit install must be reinstalled from a new tarball, while a registry install can use dsh's own plugin manager update path.

## Runtime obligations

- Consume public services and extension points; do not patch the Agent loop or edit application-owned profiles.
- Keep every registration and background resource tied to plugin disposal. Per-agent registrations must also be disposed when their Agent stops owning them.
- Keep model-visible memory in durable context or tool results so session replay can reconstruct what the model saw. Do not mutate an already derived model request.
- Treat plugin memory as derived data. Store memory versions, processing cursors, and audit records outside the canonical session event log; third-party plugins must not append novel Session event types or rely on experimental `appendPluginRecord` records.
- Restrict session reads by configured project scope. The internal `sessionQuery` service itself is trusted infrastructure and does not authorize individual callers.
- Validate model responses, persisted files, and configuration. Preserve pending or failed outcomes instead of reporting successful consolidation after an incomplete write.
- Declare tunable budgets and scheduling choices in `Config`. A configuration replacement must not leave old timers or pending writes running.
- Mount and dispose Client locale dictionaries, Remote contributions, and slots through their context effects. Keep user-visible labels in the locale resources and render memory content as text.

## Installable artifact checks

Build and inspect the actual distribution, rather than treating a source import as installation proof:

```sh
npm ci
npm run check
npm pack --dry-run
npm pack
```

The tarball must contain `lib/index.js`, `lib/index.d.ts`, `client.js`, `cordis.patch.yml`, both locale files, and `icon.svg`. Confirm that the exported paths resolve from an extracted or installed package. A prebuilt tarball does not need an install-time build script. Source Git installation is not the documented distribution path for this project.

For a consumer smoke test, use a dedicated temporary DSH home and profile, leaving the user's existing profile unchanged. With the tested DSH CLI on `PATH`:

```sh
DSH_HOME=/absolute/path/to/test-home dsh plugin --profile dreaming-smoke add /absolute/path/to/dsh-plugin-dreaming-0.4.0.tgz
DSH_HOME=/absolute/path/to/test-home dsh --profile dreaming-smoke --dump-config
```

The composed configuration must show the `dsh-plugin-dreaming` bundle layer and plugin row. Runtime verification must then activate the plugin in a composed Cordis Host, invoke its registered tools with fixture sessions, verify a later Agent receives memory context, and dispose the plugin. A manifest check or `--dump-config` alone does not establish runtime behavior.

For Web verification, use an isolated Web profile, install the same tarball, launch with a test-only project allowlist, and open **Memory** in the actual Harness sidebar. Verify project switching, counters, title/content/evidence search, category and retired-status filtering, evidence details, empty/error states, and the confirmation and persisted outcome of removal/restoration. Run these writes on disposable records and restore test state afterward. Check both supplied locales and the browser console. Do not infer rendered behavior from a registered slot or successful Host RPC test.

Keyless integration tests should use real DSH services and a scripted model adapter. Fixture responses verify mechanics, evidence validation, and replay; they do not establish a live model's memory quality. Live model evaluation requires separately configured provider credentials. Resource inspection establishes metadata packaging; rendered Plugin Manager appearance requires a browser check and should be reported separately.

## Official references

The following upstream documents were inspected for this implementation. Links point to the evolving upstream branch; this package's exact version declarations remain the compatibility promise.

- [Your first plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md): module exports, injection, and effect cleanup.
- [Plugin configuration](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.md): Schemastery schemas, defaults, validation, and hot replacement.
- [Package and install a plugin](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md): bundle manifests, patch composition, shared peers, compatibility admission, and tarball installation.
- [Official plugin development skill](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md): implementation and verification workflow.
- [Host plugin reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md): localized metadata, icon distribution, and profile ownership.
- [UI plugin reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/references/ui-plugin.md): Client manifest, module loader, and slots.
- [User action reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/references/user-actions.md): shared Host operations and UI/agent interaction paths.
- [Harness plugin practices](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/preset/agent-preset/skills/cordis-plugin-development/references/practices.md): logged model input, event compatibility, ownership, and extension points.
- [Tool authoring reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-a-tool.md): validated arguments, canonical outputs, cancellation, and replayable presentation.
- [Session query service](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session-query/session-query/README.md): exact history reads, filters, and caller authorization limits.
- [Agent loop testkit](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/test-support/agent-loop-testkit/README.md): keyless tests with the production loop and real Agents.

The official skill's in-Harness `plugin_manager` workflow applies when that tool is available. This project can also be installed through the public CLI workflow documented above. It never edits a user's profile manifest directly.
