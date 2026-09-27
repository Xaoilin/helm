/**
 * Consumer side of the contract with the Spring Boot services. Each fixture in contracts/ is an
 * example response that the services' own tests verify against their real responses, and the app
 * uses them as API mocks. The app's runtime schemas must accept every one of them.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTRACT_SCHEMAS as SERVICE_SCHEMAS } from '../services/backend/contracts';
import { ACTIVITY_CONTRACT_SCHEMAS } from '../services/backend/activityContracts';
import { KNOWLEDGE_CONTRACT_SCHEMAS } from '../services/backend/knowledgeContracts';
import { LIFE_CONTRACT_SCHEMAS } from '../services/backend/lifeContracts';
import { LIVE_CONTRACT_SCHEMAS } from '../services/backend/liveContracts';
import { PLANNER_CONTRACT_SCHEMAS } from '../services/backend/plannerContracts';

const CONTRACT_SCHEMAS = {
  ...SERVICE_SCHEMAS, ...LIFE_CONTRACT_SCHEMAS, ...ACTIVITY_CONTRACT_SCHEMAS, ...KNOWLEDGE_CONTRACT_SCHEMAS,
  ...PLANNER_CONTRACT_SCHEMAS, ...LIVE_CONTRACT_SCHEMAS,
};

const CONTRACTS = join(process.cwd(), 'contracts');

function fixtureNames(): string[] {
  const services = readdirSync(CONTRACTS, { withFileTypes: true }).filter(entry => entry.isDirectory());
  return services.map(entry => entry.name).flatMap(service => readdirSync(join(CONTRACTS, service))
    .filter(file => file.endsWith('.json'))
    .map(file => `${service}/${file.replace(/\.json$/u, '')}`));
}

describe('service contracts', () => {
  it('has a runtime schema for every fixture and a fixture for every schema', () => {
    expect(fixtureNames().sort()).toEqual(Object.keys(CONTRACT_SCHEMAS).sort());
  });

  it.each(fixtureNames())('accepts the %s example response', name => {
    const fixture = JSON.parse(readFileSync(join(CONTRACTS, `${name}.json`), 'utf8')) as { body: unknown };
    const result = CONTRACT_SCHEMAS[name].safeParse(fixture.body);

    expect(result.success, result.success ? '' : JSON.stringify(result.error.issues, null, 2)).toBe(true);
  });
});
