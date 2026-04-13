import { HOSTED_ASSISTANT_MODEL } from '../config';
import type { Settings } from '../types/domain';

export interface HostedAssistantModelOption {
  id: string;
  label: string;
  badge: string;
  detail: string;
}

export const HOSTED_ASSISTANT_MODEL_OPTIONS: HostedAssistantModelOption[] = [
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    badge: 'Best quality',
    detail: 'Best fit for harder planning and coding turns. Highest hosted token cost.',
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 mini',
    badge: 'Best value',
    detail: 'Lower-cost hosted model with strong general performance for day-to-day Lina turns.',
  },
  {
    id: 'gpt-5.4-nano',
    label: 'GPT-5.4 nano',
    badge: 'Lowest cost',
    detail: 'Cheapest hosted option for lightweight help. Expect more clarifications on harder requests.',
  },
];

const hostedAssistantModelOptionMap = new Map(
  HOSTED_ASSISTANT_MODEL_OPTIONS.map(option => [option.id, option]),
);

export function isCuratedHostedAssistantModel(model: string): boolean {
  return hostedAssistantModelOptionMap.has(model);
}

export function normalizeHostedAssistantModel(model?: string | null): string {
  const normalized = typeof model === 'string' ? model.trim() : '';
  if (!normalized) return HOSTED_ASSISTANT_MODEL;
  if (normalized === HOSTED_ASSISTANT_MODEL || isCuratedHostedAssistantModel(normalized)) {
    return normalized;
  }
  return HOSTED_ASSISTANT_MODEL;
}

export function getHostedAssistantModelSetting(
  settings: Pick<Settings, 'hostedModel'>,
): string {
  return normalizeHostedAssistantModel(settings.hostedModel);
}

export function getHostedAssistantModelOption(
  model: string,
): HostedAssistantModelOption | null {
  return hostedAssistantModelOptionMap.get(normalizeHostedAssistantModel(model)) || null;
}

export function getHostedAssistantModelLabel(model: string): string {
  return getHostedAssistantModelOption(model)?.label || model;
}
