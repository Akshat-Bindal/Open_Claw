import {
    Output,
    extractJsonMiddleware,
    generateText,
    stepCountIs,
    tool,
    wrapLanguageModel,
} from "ai";
import { z } from "zod";
import chalk from "chalk";
import { getAgentModel } from "../../AI/ai.config.ts";
import { ActionTracker } from "../Agent/action-tracker.ts";
import { ToolExecutor } from "../Agent/tool-executor.ts";
import { defaultAgentConfig } from "../Agent/types.ts";
import type { Plan, PlanStep } from "./types.ts";
import { createWebTools } from "./web-tools.ts";

const planSchema = z.object({
    researchSummary: z.string().optional(),
    steps: z.
        array(
            z.object({
                title: z.string(),
                description: z.string(),
                hints: z.array(z.string()).optional(),
                complexity: z.enum(["low", "medium", "high"]).optional(),
            }),
        )
        .min(5)
        .max(15),
});

function readOnlyTools(executor: ToolExecutor) {
    return {
        read_file: tool({
            description:
                "Read a text file from the workspace. Use a path relative to the project root.",
            inputSchema: z.object({
                path: z.string().describe("Relative file path"),
            }),
            execute: async ({ path: p }) => executor.readFile(p),
        }),

        list_files: tool({
            description: "List files and directories under a path.",
            inputSchema: z.object({
                path: z.string(),
                recursive: z.boolean().optional().default(false),
            }),
            execute: async ({ path: p, recursive }) =>
                executor.listFiles(p, recursive),
        }),

        search_files: tool({
            description:
                'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content substring filter.',
            inputSchema: z.object({
                root: z.string().describe("Directory to search, relative to root"),
                pattern: z
                    .string()
                    .describe("Glob-like pattern using * and ** (forward slashes)"),
                content_contains: z.string().optional(),
            }),
            execute: async ({ root, pattern, content_contains }) =>
                executor.searchFiles(root, pattern, content_contains),
        }),

        analyze_codebase: tool({
            description:
                "Summarize structure: file counts, size, extensions. Read-only.",
            inputSchema: z.object({
                path: z.string().default("."),
            }),
            execute: async ({ path: p }) => executor.analyzeCodebase(p),
        }),

        list_skills: tool({
            description:
                "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
            inputSchema: z.object({}),
            execute: async () => executor.listSkills(),
        }),

        read_skill: tool({
            description:
                "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
            inputSchema: z.object({
                path: z.string(),
            }),
            execute: async ({ path: p }) => executor.readSkill(p),
        }),
    };
}

const hasWeb=!!process.env.FIRECRAWL_API_KEY;

const PLAN_INSTRUCTIONS = (codebase: string, hasWeb: boolean) =>
    [
        `You are a senior software architect.

        Your job is to produce an implementation plan.

        You may inspect the repository using the provided read - only tools.

        After your research is complete:

            - Produce ONLY the final JSON.
            - Every implementation phase MUST become one step.
            - Never merge the whole plan into step 1.
            - Never describe future work outside the steps array.
            - Never output prose after the JSON.

        A good plan for a medium - sized feature contains 5 - 15 steps.

        Examples of good steps: 

            1. Analyze the existing project structure.
            2. Design the Todo data model.
            3. Create the storage layer.
            4. Implement the service layer.
            5. Build the CLI commands.
            6. Add validation.
            7. Test the implementation.`,
        `Workspace:${codebase}`,
        "Use read-only tools for codebase/skills research.",
        hasWeb
                ? "Web tools are available (web_search/web_crawl/fetch_url).Use only when needed."
                : "Web tools are unavailable (no FIRECRAWL_API_KEY)",
        "Output must match the provided JSON schema",
    ].join("\n");

export async function generatePlan(goal: string) {
    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);

    const model = wrapLanguageModel({
        model: getAgentModel(),
        middleware: extractJsonMiddleware()
    })
    const tools = {
        ...readOnlyTools(executor),
        ...(hasWeb? createWebTools(tracker) : {}),
    };

    console.log(chalk.cyan("\n🔍 Researching & drafting a plan…\n"));

    const result = await generateText({
        model,
        tools,
        stopWhen: stepCountIs(30),
        system: PLAN_INSTRUCTIONS(config.codebasePath, false),
        prompt: `User goal: \n ${goal}`,
        output: Output.object({ schema: planSchema }),
    });

    const validated = planSchema.parse(result.output);

    const steps: PlanStep[] = validated.steps.map((s, i) => ({
        id: `steps-${i + 1}`,
        title: s.title,
        description: s.description,
        hints: s.hints,
        complexity: s.complexity,
    }));

    return { goal, researchSummary: validated.researchSummary, steps }
}
