import chalk from "chalk";
import {select,isCancel} from "@clack/prompts";
import { runAgentMode } from "./Agent/orchestrator";
import { runAskMode } from "./Ask/orchestrator";
import { runPlanMode } from "./Plan/orchestrator";

export async function runCliMode() {
    while(true){
        const mode=await select({
            message:"Select a Sub-Mode",
            options:[
                {value:"Agent",label:"Agent Mode"},
                {value:"Plan",label:"Plan Mode"},
                {value:"Ask",label:"Ask Mode"},
                {value:"Back",label:"<- Back to Main Menu"},
            ]
        });
    
        if(isCancel(mode) || mode=="Back") return;

        if(mode=="Agent"){
            await runAgentMode();
        }
        if(mode=="Ask"){
            await runAskMode();
        }
        if(mode=="Plan"){
            await runPlanMode();
        }

        if(mode!="Agent" && mode!="Ask" && mode!="Plan" ){
            console.log(chalk.yellow("\n That mode is not available yet \n"));
        }
    }
}