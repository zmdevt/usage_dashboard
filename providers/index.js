// Provider registry. Each provider exports:
//   { id, name, setup, configured(env), fetch(env, { signal, fetch }) -> meter inputs[] }
import claudePlan from './claude-plan.js';
import anthropicApi from './anthropic-api.js';
import openaiApi from './openai-api.js';
import githubCopilot from './github-copilot.js';
import cursorTeam from './cursor-team.js';

export const providers = [claudePlan, anthropicApi, openaiApi, githubCopilot, cursorTeam];
