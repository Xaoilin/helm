#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_OPENAI_MODEL = 'gpt-5.4';
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OUTPUT_DIR = 'test-results';

const HELP_TEXT = `Compare GPT-5.4 mini and Claude Sonnet on HELM-style prompts.

Usage:
  npm run llm-compare
  npm run llm-compare -- --prompt "Help me plan tomorrow morning"
  npm run llm-compare -- --output test-results/my-report.md

Environment:
  OPENAI_API_KEY       Required
  OPENAI_MODEL         Optional, defaults to ${DEFAULT_OPENAI_MODEL}
  ANTHROPIC_API_KEY    Required
  ANTHROPIC_MODEL      Optional, defaults to ${DEFAULT_ANTHROPIC_MODEL}

Notes:
  - This script loads .env and .env.local when present.
  - These keys stay local to the Node script and are not bundled into the web app.
`;

const SYSTEM_PROMPT = `You are Lina, the grounded assistant inside the HELM app.
Be concise, practical, and emotionally steady.
Keep responses short enough for an in-app assistant unless the user explicitly asks for depth.
Ground recommendations in the provided context.
Do not invent tasks, meetings, or finances that are not present in the prompt.`;

const DEFAULT_SCENARIOS = [
  {
    title: 'Focus Today',
    context: [
      'Tasks: ship invoice follow-up today, buy groceries, prep Friday demo, review finance budget.',
      'Events: 11:00 Product sync, 15:00 Dentist, 17:30 Gym.',
      'Mood: slightly overwhelmed and wants a calm plan.',
    ].join('\n'),
    prompt: 'What should I focus on today?',
  },
  {
    title: 'Afternoon Reset',
    context: [
      'Tasks: daily walk missed, Qur\'an reading missed, send design feedback, book train tickets.',
      'Events: 14:00 design review just finished, 18:30 family dinner.',
      'Energy: low, wants a reset without guilt.',
    ].join('\n'),
    prompt: 'I feel behind. Help me reset the afternoon in a calm, realistic way.',
  },
  {
    title: 'Weekly Plan',
    context: [
      'Goals: improve consistency, ship the finance surface, save more this month.',
      'Upcoming commitments: Wednesday dentist, Thursday release review, Friday demo.',
      'Current problem: too many small tasks, not enough focus blocks.',
    ].join('\n'),
    prompt: 'Help me plan this week so I make progress without burning out.',
  },
  {
    title: 'Money Guidance',
    context: [
      'Finance accounts: current account low after rent, savings account intact.',
      'Recent spending: takeout twice this week, several subscriptions due soon.',
      'User priority: save money without tanking momentum on work and health.',
    ].join('\n'),
    prompt: 'What should I change this month to feel more in control of money?',
  },
  {
    title: 'Morning Prep',
    context: [
      'Tomorrow: 09:00 client call, 12:30 lunch, 16:00 deep work block.',
      'Open tasks: finalize talking points, tidy notes, reply to one overdue message.',
      'It is currently late evening and the user wants a short prep plan.',
    ].join('\n'),
    prompt: 'What should I do before tomorrow morning so the day starts smoothly?',
  },
];

function parseArgs(argv) {
  const args = { prompt: '', output: '' };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--prompt') {
      args.prompt = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--output') {
      args.output = argv[index + 1] || '';
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separatorIndex = trimmed.indexOf('=');
      if (separatorIndex === -1) continue;

      const key = trimmed.slice(0, separatorIndex).trim();
      if (!key || process.env[key]) continue;

      let value = trimmed.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith('\'') && value.endsWith('\''))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

function buildUserPrompt(scenario) {
  return `HELM context:
${scenario.context}

User request:
${scenario.prompt}`;
}

function formatUsage(provider, usage) {
  if (!usage) return 'Usage unavailable';

  const inputTokens = usage.inputTokens ?? 'n/a';
  const outputTokens = usage.outputTokens ?? 'n/a';

  if (provider === 'openai') {
    const totalTokens = usage.totalTokens ?? 'n/a';
    return `input ${inputTokens}, output ${outputTokens}, total ${totalTokens}`;
  }

  return `input ${inputTokens}, output ${outputTokens}`;
}

function extractAnthropicText(data) {
  if (!Array.isArray(data?.content)) return '';

  return data.content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function callOpenAI({ apiKey, model, userPrompt }) {
  const startedAt = Date.now();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_completion_tokens: 500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  const elapsedMs = Date.now() - startedAt;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error('OpenAI returned no message content');
  }

  return {
    provider: 'openai',
    model,
    elapsedMs,
    text,
    usage: {
      inputTokens: data?.usage?.prompt_tokens,
      outputTokens: data?.usage?.completion_tokens,
      totalTokens: data?.usage?.total_tokens,
    },
  };
}

async function callAnthropic({ apiKey, model, userPrompt }) {
  const startedAt = Date.now();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      system: SYSTEM_PROMPT,
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  });

  const elapsedMs = Date.now() - startedAt;
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Anthropic error ${response.status}: ${body}`);
  }

  const data = await response.json();
  const text = extractAnthropicText(data);
  if (!text) {
    throw new Error('Anthropic returned no text content');
  }

  return {
    provider: 'anthropic',
    model,
    elapsedMs,
    text,
    usage: {
      inputTokens: data?.usage?.input_tokens,
      outputTokens: data?.usage?.output_tokens,
    },
  };
}

function renderResultSection(result) {
  const lines = [
    `### ${result.provider === 'openai' ? 'OpenAI' : 'Anthropic'}`,
    `- Model: \`${result.model}\``,
  ];

  if (result.error) {
    lines.push(`- Error: ${result.error}`);
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`- Latency: ${result.elapsedMs} ms`);
  lines.push(`- Tokens: ${formatUsage(result.provider, result.usage)}`);
  lines.push('');
  lines.push(result.text);
  lines.push('');

  return lines.join('\n');
}

function normalizeErrorResult(provider, model, error) {
  return {
    provider,
    model,
    elapsedMs: 0,
    text: '',
    usage: undefined,
    error: error instanceof Error ? error.message : String(error),
  };
}

function renderReport({ openAIModel, anthropicModel, scenarios, results }) {
  const generatedAt = new Date().toISOString();
  const sections = [
    '# Assistant Model Comparison',
    '',
    `Generated: ${generatedAt}`,
    '',
    `OpenAI model: \`${openAIModel}\``,
    `Anthropic model: \`${anthropicModel}\``,
    '',
    'This report compares hosted-model replies on the same HELM-style prompts.',
    'Provider-reported token counts are shown as returned by each API and are not normalized across vendors.',
    '',
  ];

  scenarios.forEach((scenario, index) => {
    const scenarioResults = results[index];
    sections.push(`## ${index + 1}. ${scenario.title}`);
    sections.push('');
    sections.push('**Context**');
    sections.push('');
    sections.push(scenario.context);
    sections.push('');
    sections.push('**Prompt**');
    sections.push('');
    sections.push(scenario.prompt);
    sections.push('');
    sections.push(renderResultSection(scenarioResults.openai));
    sections.push(renderResultSection(scenarioResults.anthropic));
  });

  return `${sections.join('\n')}\n`;
}

async function ensureOutputPath(outputArg) {
  if (outputArg) {
    const resolved = path.resolve(outputArg);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    return resolved;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  const directory = path.resolve(DEFAULT_OUTPUT_DIR);
  await fs.mkdir(directory, { recursive: true });
  return path.join(directory, `assistant-model-compare-${timestamp}.md`);
}

async function main() {
  await loadEnvFile(path.resolve('.env'));
  await loadEnvFile(path.resolve('.env.local'));

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  const openAIApiKey = process.env.OPENAI_API_KEY || '';
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
  const openAIModel = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const anthropicModel = process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL;

  if (!openAIApiKey || !anthropicApiKey) {
    throw new Error('Both OPENAI_API_KEY and ANTHROPIC_API_KEY are required. Add them to .env or your shell environment.');
  }

  const scenarios = args.prompt
    ? [{
        title: 'Custom Prompt',
        context: 'No extra HELM context provided.',
        prompt: args.prompt,
      }]
    : DEFAULT_SCENARIOS;

  const results = [];
  for (const scenario of scenarios) {
    const userPrompt = buildUserPrompt(scenario);
    console.log(`Comparing models for "${scenario.title}"...`);

    const [openAIResult, anthropicResult] = await Promise.allSettled([
      callOpenAI({ apiKey: openAIApiKey, model: openAIModel, userPrompt }),
      callAnthropic({ apiKey: anthropicApiKey, model: anthropicModel, userPrompt }),
    ]);

    const normalizedOpenAI = openAIResult.status === 'fulfilled'
      ? openAIResult.value
      : normalizeErrorResult('openai', openAIModel, openAIResult.reason);

    const normalizedAnthropic = anthropicResult.status === 'fulfilled'
      ? anthropicResult.value
      : normalizeErrorResult('anthropic', anthropicModel, anthropicResult.reason);

    results.push({
      openai: normalizedOpenAI,
      anthropic: normalizedAnthropic,
    });
  }

  const report = renderReport({
    openAIModel,
    anthropicModel,
    scenarios,
    results,
  });

  const outputPath = await ensureOutputPath(args.output);
  await fs.writeFile(outputPath, report, 'utf8');

  console.log(`Comparison report written to ${outputPath}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
