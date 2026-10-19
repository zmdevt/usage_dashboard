// Provider registry. Each provider exports:
//   { id, name, setup, configured(env), fetch(env, { signal, fetch }) -> meter inputs[] }
import claudePlan from './claude-plan.js';
import anthropicApi from './anthropic-api.js';
import openaiApi from './openai-api.js';
import githubCopilot from './github-copilot.js';
import cursorTeam from './cursor-team.js';
import glmCoding from './glm-coding.js';
import chatgptCodex from './chatgpt-codex.js';
import geminiAgy from './gemini-agy.js';

export const providers = [claudePlan, chatgptCodex, geminiAgy, anthropicApi, openaiApi, githubCopilot, cursorTeam, glmCoding];
