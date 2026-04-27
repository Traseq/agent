import type { CapabilityDocument, TraseqClient } from '../client/index.js';
import { asJsonObject } from '../normalize.js';
import { getSemantics, resolveStrategySemantics } from './resolver.js';
import type {
  GetSemanticsInput,
  ResolveStrategySemanticsInput,
} from './types.js';

export interface AgentToolDefinition {
  readonly name: 'get_semantics' | 'resolve_strategy_semantics';
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
  readonly local: true;
}

export type AgentToolName = AgentToolDefinition['name'];

const objectProp = { type: 'object', additionalProperties: true } as const;
const stringProp = { type: 'string' } as const;
const booleanProp = { type: 'boolean' } as const;

function objectSchema(properties: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
  };
}

export const AGENT_TOOL_REGISTRY: readonly AgentToolDefinition[] = [
  {
    name: 'get_semantics',
    description:
      'Read the local Traseq semantic ontology used by the agent-side resolver.',
    local: true,
    input_schema: objectSchema({
      family: stringProp,
      includeFragments: booleanProp,
    }),
  },
  {
    name: 'resolve_strategy_semantics',
    description:
      'Resolve strategy intent facets into capability-grounded signalGraph fragments. Local agent tool; fetches get_capabilities when capabilities are not supplied.',
    local: true,
    input_schema: objectSchema({
      facets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: stringProp,
            role: stringProp,
            weight: { type: 'number' },
          },
        },
      },
      prompt: stringProp,
      constraints: objectProp,
      capabilities: objectProp,
      includeUnavailable: booleanProp,
    }),
  },
];

export function getAgentToolDefinition(
  name: string,
): AgentToolDefinition | undefined {
  return AGENT_TOOL_REGISTRY.find((tool) => tool.name === name);
}

async function getCapabilitiesIfNeeded(
  input: ResolveStrategySemanticsInput,
  client?: Pick<TraseqClient, 'getCapabilities'>,
): Promise<CapabilityDocument> {
  const supplied = asJsonObject(input.capabilities);
  if (supplied) {
    return supplied;
  }

  if (!client) {
    throw new Error(
      'resolve_strategy_semantics requires capabilities or a Traseq client that can call get_capabilities.',
    );
  }

  return client.getCapabilities();
}

export async function runAgentTool(
  name: AgentToolName,
  rawInput: unknown = {},
  options: { client?: Pick<TraseqClient, 'getCapabilities'> } = {},
): Promise<unknown> {
  const input = asJsonObject(rawInput) ?? {};

  switch (name) {
    case 'get_semantics':
      return getSemantics(input as GetSemanticsInput);
    case 'resolve_strategy_semantics': {
      const resolveInput = input as ResolveStrategySemanticsInput;
      const capabilities = await getCapabilitiesIfNeeded(
        resolveInput,
        options.client,
      );
      return resolveStrategySemantics({
        ...resolveInput,
        capabilities,
      });
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unhandled agent tool: ${_exhaustive}`);
    }
  }
}
