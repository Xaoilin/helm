#!/usr/bin/env tsx

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ASSISTANT_BENCHMARK } from '../src/config/constants';
import { HOSTED_ASSISTANT_MODEL, OLLAMA_ENDPOINT } from '../src/config';
import {
  getAssistantBenchmarkThresholdFailures,
  runAssistantBenchmark,
  type AssistantBenchmarkPlannerRequest,
} from '../src/assistant/evals/benchmarkRunner';

const DEFAULT_OUTPUT_DIR = 'test-results';
const DEFAULT_HOSTED_FUNCTION = 'assistant-openai';
const DEFAULT_PROVIDER = 'hosted';
const DEFAULT_OLLAMA_MODEL = 'qwen3';
const MAX_RETRIES = 3;

interface HostedAssistantHealthResponse {
  ok: boolean;
  provider: 'openai';
  model: string;
}

interface HostedAssistantTurnResponse {
  ok: boolean;
  provider: 'openai';
  model: string;
  turn: {
    type: 'text' | 'tool_calls';
    text?: string;
    toolCalls?: Array<{
      callId: string;
      name: string;
      arguments: string;
    }>;
  };
  rawResponse?: string;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
}

const HELP_TEXT = `Run the HELM assistant benchmark against a live planner.

Usage:
  npm run benchmark:assistant
  npm run benchmark:assistant -- --provider hosted --enforce
  npm run benchmark:assistant -- --provider ollama --model qwen3 --output test-results/assistant-benchmark.json

Options:
  --provider hosted|ollama   Planner provider to benchmark (default: ${DEFAULT_PROVIDER})
  --model <name>             Override the provider model label
  --output <path>            Write the JSON report to a specific file
  --enforce                  Exit non-zero if the benchmark thresholds fail
  --help                     Show this help text
`;

type Provider = 'hosted' | 'ollama';

interface CliArgs {
  provider: Provider;
  model?: string;
  output?: string;
  enforce: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    provider: DEFAULT_PROVIDER,
    enforce: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--provider') {
      const provider = argv[index + 1];
      if (provider !== 'hosted' && provider !== 'ollama') {
        throw new Error(`Unsupported provider: ${provider || '(missing)'}`);
      }
      args.provider = provider;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      args.model = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--output') {
      args.output = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--enforce') {
      args.enforce = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function loadEnvFile(filePath: string): Promise<void> {
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

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === MAX_RETRIES) break;
      const delayMs = 750 * attempt;
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function getHostedConfig(modelOverride?: string) {
  const url = process.env.VITE_SUPABASE_URL || '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
  const functionName = process.env.VITE_HOSTED_ASSISTANT_FUNCTION || DEFAULT_HOSTED_FUNCTION;
  const model = modelOverride || process.env.VITE_HOSTED_ASSISTANT_MODEL || HOSTED_ASSISTANT_MODEL;

  if (!url || !anonKey) {
    throw new Error('Hosted benchmark requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  return {
    url: `${url.replace(/\/+$/u, '')}/functions/v1/${functionName}`,
    anonKey,
    model,
  };
}

async function fetchHostedHealth(modelOverride?: string): Promise<string> {
  const config = getHostedConfig(modelOverride);
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'health' }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Hosted benchmark health check failed with ${response.status}: ${body}`);
  }

  const data = await response.json() as HostedAssistantHealthResponse;
  if (!data.ok || !data.model) {
    throw new Error('Hosted benchmark health check returned no model.');
  }

  return data.model;
}

async function callHostedPlanner(
  request: AssistantBenchmarkPlannerRequest,
  modelOverride?: string,
): Promise<{
  rawResponse: string;
  planningModel: string;
  turnType: 'text' | 'tool_calls';
  text?: string;
  toolCalls?: HostedAssistantTurnResponse['turn']['toolCalls'];
}> {
  const config = getHostedConfig(modelOverride);
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'turn',
      messages: request.messages,
      format: request.format,
      tools: request.tools,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Hosted planner failed with ${response.status}: ${body}`);
  }

  const data = await response.json() as HostedAssistantTurnResponse;
  if (!data.ok || !data.turn || (data.turn.type !== 'text' && data.turn.type !== 'tool_calls')) {
    throw new Error('Hosted planner returned an invalid orchestration turn.');
  }

  return {
    rawResponse: data.rawResponse || data.turn.text || JSON.stringify(data.turn.toolCalls || []),
    planningModel: data.model || config.model,
    turnType: data.turn.type,
    text: data.turn.text,
    toolCalls: data.turn.toolCalls || [],
  };
}

function getOllamaConfig(modelOverride?: string) {
  return {
    endpoint: process.env.VITE_OLLAMA_ENDPOINT || OLLAMA_ENDPOINT,
    model: modelOverride || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
  };
}

async function checkOllamaAvailable(endpoint: string): Promise<void> {
  const response = await fetch(`${endpoint.replace(/\/+$/u, '')}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama benchmark could not reach ${endpoint} (${response.status}).`);
  }
}

async function callOllamaPlanner(
  request: AssistantBenchmarkPlannerRequest,
  modelOverride?: string,
): Promise<{ rawResponse: string; planningModel: string; turnType: 'text'; text: string }> {
  const config = getOllamaConfig(modelOverride);
  const response = await fetch(`${config.endpoint.replace(/\/+$/u, '')}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: request.messages,
      stream: false,
      think: false,
      format: request.format,
      options: {
        temperature: 0.2,
        num_predict: 300,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama planner failed with ${response.status}: ${body}`);
  }

  const data = await response.json() as OllamaChatResponse;
  const rawResponse = data.message?.content?.trim() || '';
  if (!rawResponse) {
    throw new Error('Ollama planner returned an empty response.');
  }

  return {
    rawResponse,
    planningModel: config.model,
    turnType: 'text',
    text: rawResponse,
  };
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function ensureOutputPath(outputArg?: string): Promise<string> {
  if (outputArg) {
    const resolved = path.resolve(outputArg);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    return resolved;
  }

  const directory = path.resolve(DEFAULT_OUTPUT_DIR);
  await fs.mkdir(directory, { recursive: true });
  return path.join(directory, 'assistant-benchmark-report.json');
}

async function main(): Promise<void> {
  await loadEnvFile(path.resolve('.env'));
  await loadEnvFile(path.resolve('.env.local'));

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP_TEXT);
    return;
  }

  let providerModel = '';
  if (args.provider === 'hosted') {
    providerModel = await retry(() => fetchHostedHealth(args.model));
  } else {
    const config = getOllamaConfig(args.model);
    await retry(() => checkOllamaAvailable(config.endpoint));
    providerModel = config.model;
  }

  const report = await runAssistantBenchmark({
    provider: args.provider,
    planner: async (request) => {
      if (args.provider === 'hosted') {
        const response = await retry(() => callHostedPlanner(request, args.model));
        return {
          rawResponse: response.rawResponse,
          planningSource: 'openai' as const,
          planningModel: response.planningModel,
          turnType: response.turnType,
          text: response.text,
          toolCalls: response.toolCalls,
        };
      }

      const response = await retry(() => callOllamaPlanner(request, args.model));
      return {
        rawResponse: response.rawResponse,
        planningSource: 'ollama' as const,
        planningModel: response.planningModel,
        turnType: response.turnType,
        text: response.text,
      };
    },
  });

  const outputPath = await ensureOutputPath(args.output);
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const thresholdFailures = getAssistantBenchmarkThresholdFailures(report.summary);
  const failedCases = report.results.filter(result => !result.passed);

  console.log(`Assistant benchmark provider: ${report.provider}`);
  console.log(`Assistant benchmark model: ${report.model || providerModel}`);
  console.log(`Cases: ${report.summary.total}`);
  console.log(`Overall: ${report.summary.passed}/${report.summary.total} (${formatPercent(report.summary.passRate)})`);
  console.log(`Destructive: ${report.summary.destructive.passed}/${report.summary.destructive.total} (${formatPercent(report.summary.destructive.passRate)})`);
  console.log(`Unsupported: ${report.summary.unsupported.passed}/${report.summary.unsupported.total} (${formatPercent(report.summary.unsupported.passRate)})`);
  console.log(`Annotated entity selection: ${report.summary.entitySelection.passed}/${report.summary.entitySelection.total} (${formatPercent(report.summary.entitySelection.passRate)})`);
  console.log(`Report: ${outputPath}`);

  if (failedCases.length > 0) {
    console.log('');
    console.log('Failing cases:');
    for (const failure of failedCases.slice(0, ASSISTANT_BENCHMARK.MAX_FAILURES_IN_SUMMARY)) {
      console.log(`- ${failure.id} "${failure.transcript}"`);
      console.log(`  ${failure.failureReason || 'Failed without a recorded reason.'}`);
    }
    if (failedCases.length > ASSISTANT_BENCHMARK.MAX_FAILURES_IN_SUMMARY) {
      console.log(`- ...and ${failedCases.length - ASSISTANT_BENCHMARK.MAX_FAILURES_IN_SUMMARY} more failing cases.`);
    }
  }

  if (thresholdFailures.length > 0) {
    console.log('');
    console.log('Threshold failures:');
    for (const failure of thresholdFailures) {
      console.log(`- ${failure}`);
    }
  }

  if (args.enforce && thresholdFailures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
