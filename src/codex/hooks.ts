import { type CodexConfig, projectForDirectory } from './config.ts'
import { CodexDreamService } from './service.ts'
import { hookSchema } from './traces.ts'

export async function handleHook(config: CodexConfig, raw: unknown): Promise<object> {
  const input = hookSchema.parse(raw)
  const service = new CodexDreamService(config)
  try {
    const result = await service.traces.capture(input)
    if (result.warning) return { systemMessage: `Dream Trace: ${result.warning}` }
    if (input.agent_id || input.agent_type || !result.projectRoot) return {}
    if (input.hook_event_name === 'SessionStart' || input.hook_event_name === 'UserPromptSubmit') {
      const projectRoot = await projectForDirectory(config, input.cwd)
      if (projectRoot !== result.projectRoot) return {}
      const index = await service.index(projectRoot)
      if (index) return { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: index } }
    }
    return {}
  } finally { await service.close() }
}
