/** Validated, deployment-owned limits for the Dreaming plugin. */
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import Schema from '@deepseek-ai/schemastery';
import { z } from 'zod';
export const configSchema = z.object({
    projectRoots: z.array(z.string().min(1).refine(isAbsolute)).default([]),
    storageDirectory: z.string().min(1).refine(isAbsolute).default(join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dreaming')),
    provider: z.string().min(1).default('deepseek-official'),
    model: z.string().min(1).default('deepseek-flash'),
    autoRunIntervalMinutes: z.number().int().min(0).max(10080).default(0),
    autoRunAfterTurn: z.boolean().default(false),
    afterTurnDelaySeconds: z.number().int().min(1).max(86400).default(30),
    maxSessionsPerRun: z.number().int().min(1).max(1000).default(10),
    maxEventsPerRun: z.number().int().min(1).max(100000).default(2000),
    maxInputChars: z.number().int().min(4000).max(1000000).default(60000),
    maxProposalChars: z.number().int().min(500).max(200000).default(12000),
    maxFacts: z.number().int().min(1).max(10000).default(100),
    maxFactChars: z.number().int().min(100).max(12000).default(1800),
    maxFactsPerRun: z.number().int().min(1).max(100).default(20),
    maxIndexChars: z.number().int().min(256).max(32000).default(4000),
    maxOutputTokens: z.number().int().min(256).max(64000).default(6000),
    runTimeoutSeconds: z.number().int().min(1).max(3600).default(180),
    searchLimit: z.number().int().min(1).max(100).default(20),
    verify: z.boolean().default(true),
}).strict().refine(config => config.maxProposalChars + 1000 < config.maxInputChars, { message: 'maxInputChars must leave room for maxProposalChars plus at least 1000 characters of evidence.' });
/** Loader-facing schema; the same parser also validates direct API callers. */
export const Config = Schema.object({
    projectRoots: Schema.array(Schema.string()).default([]).description('Absolute project directories allowed to contribute memory.'),
    storageDirectory: Schema.string().default(configSchema.parse({}).storageDirectory).description('Absolute directory for versioned derived memory.'),
    provider: Schema.string().default('deepseek-official'),
    model: Schema.string().default('deepseek-flash'),
    autoRunIntervalMinutes: Schema.number().default(0).description('Periodic background interval; zero disables it.'),
    autoRunAfterTurn: Schema.boolean().default(false),
    afterTurnDelaySeconds: Schema.number().default(30),
    maxSessionsPerRun: Schema.number().default(10),
    maxEventsPerRun: Schema.number().default(2000),
    maxInputChars: Schema.number().default(60000),
    maxProposalChars: Schema.number().default(12000),
    maxFacts: Schema.number().default(100),
    maxFactChars: Schema.number().default(1800),
    maxFactsPerRun: Schema.number().default(20),
    maxIndexChars: Schema.number().default(4000),
    maxOutputTokens: Schema.number().default(6000),
    runTimeoutSeconds: Schema.number().default(180),
    searchLimit: Schema.number().default(20),
    verify: Schema.boolean().default(true).description('Require a separate semantic review before committing proposed memory.'),
});
//# sourceMappingURL=config.js.map