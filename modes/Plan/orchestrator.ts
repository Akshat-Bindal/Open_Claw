import chalk from "chalk";
import { isCancel, confirm, text } from "@clack/prompts";
import { ToolLoopAgent, stepCountIs } from "ai";
import { getAgentModel } from "../../AI/ai.config";
import { ActionTracker } from "../Agent/action-tracker";
import { ToolExecutor } from "../Agent/tool-executor.ts";
import { createAgentTools } from "../Agent/agent-tools.ts";
import { defaultAgentConfig } from "../Agent/types.ts";
import { runApprovalFlow } from "../Agent/approval.ts";
import { renderTerminalMarkdown } from "../../tui/terminal-md.ts";
import { generatePlan } from "./planner.ts";
import { printPlan, selectsteps } from "./selection.ts";
import type { PlanStep } from "./types.ts";
import { createWebTools } from "./web-tools.ts";



function stepPrompt(goal: string, step: PlanStep): string {
    return [`Goal: ${goal}`, `Step: ${step.title}`, step.description].join('\n');
}

export async function runPlanMode(): Promise<void> {
    console.log(chalk.bold("\n🧭 Plan Mode\n"));

    const goal = await text({ message: "What is your goal?" });
    if (isCancel(goal) || !goal.trim()) return;

    const plan = await generatePlan(goal);

    printPlan(plan);

    const selected = await selectsteps(plan);
    if (selected.length === 0) return;

    const proceed = await confirm({
        message: `Execute ${selected.length} steps(s)`,
        initialValue: true,
    });

    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);

    const tools = {
        ...createAgentTools(executor),
        ...createWebTools(tracker),
    };

    for (const step of selected) {
        console.log(chalk.bold(`\n ${step.title}\n`));

        const agent = new ToolLoopAgent({
            model: getAgentModel(),
            stopWhen: stepCountIs(30),
            tools,
        });

        const r = await agent.generate({ prompt: stepPrompt(plan.goal, step) });

        if (r.text) return console.log(renderTerminalMarkdown(r.text));
    }

    const ok = await runApprovalFlow(tracker);
    if (!ok) return executor.clearStaging();

    const { errors } = executor.applyApprovedFromTracker();
    if (errors.length) {
        console.log(chalk.red('\nSome operations reported errors:\n'));
        for (const e of errors) console.log(chalk.red(`  • ${e}`));
    } else {
        console.log(chalk.green('\n✓ Applied.\n'));
    }
    executor.clearStaging();
}
