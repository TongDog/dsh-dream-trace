# Dream Trace：Codex 项目记忆插件

把 Codex 中可见的项目观察整理为带证据的长期记忆。提供检索、复盘、独立语义复核、删除当前记忆和版本回滚；新会话、恢复、压缩后及新用户回合可自动加载短索引。

复用 Dreaming 的记忆核心，**不需要安装或运行 DeepSeek Harness**。这是社区插件，不是 OpenAI 官方产品。需要 Node.js >=24.9.0，以及支持本包 hooks 的本地 Codex。当前实现面向本地桌面/CLI，未验证 Codex Cloud 或 Windows。

## 安装

### 从本仓库构建

在仓库根目录执行：

```sh
npm ci
npm run check
codex plugin marketplace add /绝对路径/dsh-dreaming/codex-plugin
codex plugin add dream-trace@dream-trace-local
```

先构建再安装，安装会复制插件到 Codex 缓存。更新源码后重新构建并重新安装，不能假设缓存会自动更新。

### 分发独立安装包

```sh
npm run pack:codex
```

生成 `codex-plugin-dream-trace-0.1.0.tgz`。解压后，对包含 `.codex-plugin/plugin.json` 的 `package` 目录执行同样的 `codex plugin marketplace add /绝对路径/package` 和 `codex plugin add dream-trace@dream-trace-local`。包已包含运行代码及依赖，无需在解压目录执行 `npm install`。

### 启用项目和模型

1. 复制包内 `config.example.json` 到 `~/.codex/dream-trace/config.json`。若设置了 `CODEX_HOME`，默认位置是 `$CODEX_HOME/dream-trace/config.json`。也可以用 `DREAM_TRACE_CONFIG` 指定一个绝对路径；hooks 与 MCP 必须使用同一份配置。
2. 把 `projectRoots` 改为授权项目的绝对路径。默认空数组不采集任何项目。路径会规范化，不允许重复或父子目录重叠；worktree 需要作为独立根目录显式启用。
3. 填写支持 Chat Completions JSON 模式的模型服务。`name` 是提供方的实际模型 ID；`baseUrl` 是包含 `/v1` 等前缀的基础地址，程序在其后追加 `/chat/completions`。
4. 在启动 Codex 的环境中设置 `DREAM_TRACE_API_KEY`。不要把密钥写入配置或 Skill。桌面程序需要从具有该环境变量的环境启动；仅在另一个终端 `export` 不会修改已运行的桌面进程环境。
5. 重启 Codex，按 Codex 的信任流程检查并启用插件 hooks（CLI 可用 `/hooks`），再新建项目聊天。安装插件本身不会自动信任 hooks。

配置示例（占位值必须替换）：

```json
{
  "projectRoots": ["/absolute/path/to/project"],
  "autoRun": false,
  "verify": true,
  "model": {
    "baseUrl": "https://api.openai.com/v1",
    "name": "YOUR_MODEL_ID",
    "apiKeyEnv": "DREAM_TRACE_API_KEY",
    "tokenLimitField": "max_completion_tokens"
  }
}
```

兼容服务若使用 `max_tokens`，修改 `tokenLimitField`。HTTP 只允许本机回环地址；远程服务要求 HTTPS。模型调用使用独立 API 凭据，不读取 Codex 登录文件，也不自动使用 ChatGPT 订阅额度。

只检索已有记忆时可以省略 `model`。启用复盘会把所选脱敏观察和旧记忆发送给配置的模型服务；复核默认开启，通常会再调用一次模型。只推进空证据游标或没有新增已停止片段时不调用模型。

默认 MCP 配置转发 `DREAM_TRACE_API_KEY`、`DREAM_TRACE_CONFIG` 和 `CODEX_HOME`。若使用其他 `apiKeyEnv`，需要把该变量也加入 MCP 的 `env_vars`，并确保启动环境中存在它。

## 使用

完成一轮项目工作后，可以对 Codex 说：

- “用 Dream Trace 复盘这个项目已经完成的工作，更新记忆。”
- “查一下我们之前对测试和发布流程有什么约定，并给出来源。”
- “忘记这条记忆。”
- “查看记忆版本，把项目记忆恢复到版本 2。”

| 工具 | 功能 |
|---|---|
| `dream_status` | 查询项目、版本、游标、当前进程内的后台状态和最近错误 |
| `memory_index` | 获取当前版本的短索引 |
| `memory_search` | 字面关键词检索，支持中文子串 |
| `memory_read` | 读取完整记忆、原文引述、观察时间及来源 |
| `dream_run` | 手动复盘一批已采集并到达 Stop 边界的观察 |
| `memory_forget` | 移除当前记忆，保留历史 |
| `dream_rollback` | 恢复历史内容与游标，形成新版本 |

多项目时工具需要传入 `dream_status` 列出的准确 `projectRoot`。只启用一个项目时可以省略。模型工具可访问配置中所有授权根目录；它们没有来自 Codex 的独立“当前聊天项目”授权令牌，所以不要把此本地服务作为多用户共享服务。

`deferred: true` 表示还有片段未处理，可以再次复盘。`BUSY` 表示已有写操作。`COMMIT_UNKNOWN` 或写响应丢失时，先查询版本再决定是否重试。输入预算不足时会失败，不会截断证据后假装成功。

终端诊断也可直接运行：

```sh
node /绝对路径/codex-plugin/dist/cli.mjs status
node /绝对路径/codex-plugin/dist/cli.mjs run /绝对路径/项目
```

## 自动记忆

设置 `autoRun: true` 并重启 MCP 后，服务默认每 30 秒检查一次新增观察，使用与手动复盘相同的预算、复核和事务机制。`autoRunIntervalSeconds` 可调整间隔（最小 10 秒）。

hooks 只做本地采集和加载，不在用户工具执行路径中调用模型。后台复盘在 MCP 进程中运行；关闭 Codex/MCP 会取消正在运行的任务。重启后依靠持久化游标继续处理积压，不需要独立守护进程。最近错误和 `running` 状态是进程内信息，重启会重置。

`SessionStart` 与 `UserPromptSubmit` 注入带版本的短索引；完整内容仍通过 MCP 读取。自动复盘产生的新版本会在下次上述 hook 或 `memory_index` 调用时可见，不会强行修改正在进行的模型请求。

## 采集与证据边界

- **只记录启用之后实际送达的 hooks。** 不扫描 `~/.codex/sessions`、私有数据库或历史 transcript，不导入安装前的聊天。默认的安全空配置、未信任 hooks、进程故障或未覆盖工具都会造成观察缺口。
- `UserPromptSubmit` 保存输入；`PostToolUse` 保存可见调用和结果；`Stop` 保存最后回答并形成一个可复盘片段。Stop 是观察边界，不证明任务成功，也不保证其他 Stop hook 不会要求继续。
- 相同 hook 重投不会重复写入；同一 turn 的后续 prompt 保守视为 assistant 来源，防止 Stop 自动续跑被当成用户偏好。分叉只记录新会话实际产生的 hooks，不复制继承历史。带子代理标识的事件会排除。
- `Interrupt`、跨项目 `cwd` 或显式工具 `cwd/workdir` 会排除当前未结束片段。已发布的早期 Stop 片段不会因后续中断自动撤销。范围判断基于 hook 元数据及显式工作目录，不分析 shell 命令中的任意文件路径。
- 不保存 transcript 路径、隐藏推理、图片/音频和不透明块。过滤插件自身的记忆工具结果，对可识别凭据脱敏。脱敏不是完整秘密识别；不要授权不应发送给所选模型的项目。
- 超过单次采集预算或字段不完整的片段会尽量标记排除并返回警告。hook 本身执行失败不能证明完整采集；程序不会阻止用户继续工作。模型不得把没有记录的工作补写成“事实”。
- 引用中的 `sessionId` 为 `codex:<原会话 ID>`，`seq` 是 **Dream Trace 自己的记录序号**，不是 Codex 私有日志行号。`supported` 表示引用支持限定范围内的观察，不等于独立验证的普遍真理。

## 配置与存储

配置严格校验，不接受未知字段。重要默认值：

| 字段 | 默认值 | 用途 |
|---|---|---|
| `storageDirectory` | `$CODEX_HOME/dream-trace/data` 或 `~/.codex/dream-trace/data` | 私有本地数据目录 |
| `maxCaptureChars` | 100000 | 一次 hook 可见文本预算 |
| `maxSessionsPerRun` / `maxEventsPerRun` | 10 / 2000 | 单批观察数量 |
| `maxInputChars` / `maxProposalChars` | 60000 / 12000 | 模型数据与提案字符预算 |
| `maxFacts` / `maxFactChars` / `maxFactsPerRun` | 100 / 1800 / 20 | 当前记忆及单批变更上限 |
| `maxIndexChars` / `searchLimit` | 4000 / 20 | 索引及检索预算 |
| `maxOutputTokens` / `runTimeoutSeconds` | 6000 / 180 | 每次模型输出与整个复盘超时 |

提高 `runTimeoutSeconds` 时也要调整 MCP `tool_timeout_sec`（包内默认 240 秒）。所有模型调用合计受整个复盘超时约束。预算是字符数或条数时不等同于计费 token。

```text
data/
  traces/<会话ID的SHA-256>.json       # 原始可见观察，schemaVersion=1
  memory/<规范项目路径的SHA-256>/
    current.json                    # 原子发布指针
    revision-N.json                 # 不可变记忆版本和游标
```

新建目录和 trace 文件分别使用 0700/0600 权限。写入采用锁、原子替换与 fsync。Trace 目前按整个会话快照读写，单文件读取上限 64 MiB；长会话有额外 I/O 成本。历史未自动裁剪。

记忆与 trace 应一起备份。不要单独删除已被游标引用的 trace；插件会报错，防止错误重用位置。`memory_forget` 不是安全擦除，原始观察及旧版本仍保留。卸载插件不删除数据。项目移动后需配置新路径，数据不自动迁移。

## 开发与验证

源码在 `src/codex/`，共享核心在 `src/core/`；不要直接修改构建产物。仓库根目录执行：

```sh
npm run check
node scripts/verify-codex-package.mjs
```

包验证使用临时项目、临时 Codex 配置、真实 MCP SDK stdio 客户端和本机脚本化模型响应，不发送个人历史、不消耗线上模型额度。另通过真实 Codex App Server 检查安装后的 5 个 hooks 和 7 个 MCP 工具。源码测试验证取消、复核拒绝、项目隔离和并发等边界；脚本化响应不证明线上模型的记忆质量。

当前分发使用 `.codex-plugin/plugin.json` 兼容清单和 `.mcp.json`；MCP 的 `cwd: "./"` 由 Codex 相对插件根目录解析，入口参数使用 `./dist/cli.mjs`。该布局已在本机 Codex `0.164.0-alpha.11.1` 验证。请勿直接换成 `${CLAUDE_PLUGIN_ROOT}` 参数或添加根 `plugin.json`：本机版本对这些组合的处理不同，曾出现安装成功但 hooks 未加载或 MCP 握手失败。更换清单格式应重新执行包验证。

官方参考：[插件打包](https://developers.openai.com/plugins/build/plugins)、[Codex hooks](https://learn.chatgpt.com/docs/hooks)、[MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。当前带 hooks 的插件面向本地手动安装，不符合公共插件目录的 hooks 发布限制。
