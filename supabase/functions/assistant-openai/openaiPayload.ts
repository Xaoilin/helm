export type AssistantMessageRole = 'system' | 'user' | 'assistant';

export interface AssistantMessage {
  role: AssistantMessageRole;
  content: string;
}

type OpenAIInputMessageRole = Extract<AssistantMessageRole, 'user' | 'assistant'>;
type OpenAIInputContentType = 'input_text' | 'output_text';

interface OpenAIInputContentItem {
  type: OpenAIInputContentType;
  text: string;
}

interface OpenAIInputMessage {
  role: OpenAIInputMessageRole;
  content: [OpenAIInputContentItem];
}

interface BuildOpenAIResponsesPayloadOptions {
  model: string;
  messages: AssistantMessage[];
  format?: unknown;
  tools?: OpenAIToolDefinition[];
}

export interface OpenAIToolDefinition {
  type: 'function';
  name: string;
  description: string;
  parameters: unknown;
  strict?: boolean;
}

const SYSTEM_SEPARATOR = '\n\n';
const OPENAI_CONTENT_TYPES: Record<OpenAIInputMessageRole, OpenAIInputContentType> = {
  user: 'input_text',
  assistant: 'output_text',
};

export function isAssistantMessage(value: unknown): value is AssistantMessage {
  return typeof value === 'object'
    && value !== null
    && 'role' in value
    && 'content' in value
    && (value.role === 'system' || value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string';
}

function isOpenAIInputRole(role: AssistantMessageRole): role is OpenAIInputMessageRole {
  return role === 'user' || role === 'assistant';
}

export function toOpenAIInputMessage(message: AssistantMessage): OpenAIInputMessage | null {
  if (!isOpenAIInputRole(message.role)) {
    return null;
  }

  return {
    role: message.role,
    content: [
      {
        type: OPENAI_CONTENT_TYPES[message.role],
        text: message.content,
      },
    ],
  };
}

export function buildOpenAIResponsesPayload(
  {
    model,
    messages,
    format,
    tools,
  }: BuildOpenAIResponsesPayloadOptions,
) {
  const instructions = messages
    .filter(message => message.role === 'system')
    .map(message => message.content.trim())
    .filter(Boolean)
    .join(SYSTEM_SEPARATOR);

  const input = messages
    .map(toOpenAIInputMessage)
    .filter((message): message is OpenAIInputMessage => message !== null);

  return {
    model,
    store: false,
    temperature: 0.2,
    max_output_tokens: 600,
    instructions: instructions || undefined,
    input,
    ...(format
      ? {
          text: {
            format: {
              type: 'json_schema',
              name: 'helm_action_plan',
              description: 'Structured action plan for Sabah One assistant turns.',
              schema: format,
              strict: true,
            },
          },
        }
      : {}),
    ...(tools && tools.length > 0
      ? {
          tools: tools.map(tool => ({
            type: 'function',
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: tool.strict ?? true,
          })),
        }
      : {}),
  };
}
