import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contract = JSON.parse(readFileSync(
  resolve(root, 'docs/contracts/external-evidence-routes.v1.json'),
  'utf8',
)) as {
  $schema: string;
  ticket: string;
  researchCutoff: string;
  approvalGate: string;
  globalContract: {
    credentialBoundary: Record<string, string>;
    heroRule: string;
  };
  routes: Array<{
    provider: string;
    capabilityFinding: string;
    recommendedRoute: string;
    approvalStatus: string;
    automation: { supported: boolean; mode: string; summary: string };
    userAssistedSteps: string[];
    authentication: { permissions: string[]; writesAllowed: boolean; clientSecretInBrowser: boolean };
    credentialBoundary: Record<string, string>;
    dataMinimisation: { retainedFields: string[]; discardedFields: string[] };
    provenance: { sourceTier: string; stableIdentity: string; freshness: string };
    heroMapping: { status: string; evidenceType: string; reason: string; qualification: string; excluded: string[] };
    failureBehavior: string[];
    fallback: { route: string; sourceTier: string; behavior: string };
    costsAndPrerequisites: string[];
    tests: string[];
    primaryEvidence: Array<{ title: string; url: string; checkedAt: string; finding: string }>;
    unknownFinding?: { checkedAt: string; finding: string; safeConsequence: string };
    revisitTriggers: string[];
  }>;
};

const expectedProviders = ['barclays', 'eight-sleep', 'elif-b', 'github', 'iphone-movement'];
const officialHosts = new Set([
  'www.barclays.co.uk',
  'www.openbanking.org.uk',
  'standards.openbanking.org.uk',
  'developer.apple.com',
  'support.apple.com',
  'help.eightsleep.com',
  'www.eightsleep.com',
  'docs.github.com',
]);

describe('KAN-263 external evidence route freeze', () => {
  it('covers exactly the five ticket providers behind the explicit approval gate', () => {
    expect(contract.$schema).toBe('sabah-one/external-evidence-routes/v1');
    expect(contract.ticket).toBe('KAN-263');
    expect(contract.researchCutoff).toBe('2026-08-30');
    expect(contract.approvalGate).toBe('pending-sol-presentation-and-my-liege-approval');
    expect(contract.routes.map(route => route.provider).sort()).toEqual(expectedProviders);
    expect(contract.routes.every(route => route.approvalStatus === 'proposed')).toBe(true);
  });

  it('requires complete automation, assistance, minimisation, provenance, failure, fallback, cost, and test contracts', () => {
    for (const route of contract.routes) {
      expect(route.capabilityFinding).not.toBe('');
      expect(route.recommendedRoute).not.toBe('');
      expect(route.automation.mode).not.toBe('');
      expect(route.automation.summary).not.toBe('');
      expect(route.userAssistedSteps.length).toBeGreaterThan(0);
      expect(route.authentication.permissions.length).toBeGreaterThan(0);
      expect(route.authentication.writesAllowed).toBe(false);
      expect(route.authentication.clientSecretInBrowser).toBe(false);
      expect(Object.keys(route.credentialBoundary).sort()).toEqual(['account', 'browser', 'server']);
      expect(route.dataMinimisation.retainedFields.length).toBeGreaterThan(0);
      expect(route.dataMinimisation.discardedFields.length).toBeGreaterThan(0);
      expect(route.provenance.sourceTier).toMatch(/^(trusted_integration|self_reported)$/);
      expect(route.provenance.stableIdentity).not.toBe('');
      expect(route.provenance.freshness).not.toBe('');
      expect(route.heroMapping.qualification).not.toBe('');
      expect(route.heroMapping.excluded.length).toBeGreaterThan(0);
      expect(route.failureBehavior.length).toBeGreaterThan(0);
      expect(route.fallback.route).not.toBe('');
      expect(route.fallback.behavior).not.toBe('');
      expect(route.costsAndPrerequisites.length).toBeGreaterThan(0);
      expect(route.tests.length).toBeGreaterThan(0);
      expect(route.revisitTriggers.length).toBeGreaterThan(0);
    }
  });

  it('uses dated official sources or an explicit dated unknown finding', () => {
    for (const route of contract.routes) {
      expect(route.primaryEvidence.length > 0 || route.unknownFinding).toBeTruthy();

      for (const evidence of route.primaryEvidence) {
        const url = new URL(evidence.url);
        expect(url.protocol).toBe('https:');
        expect(officialHosts.has(url.hostname)).toBe(true);
        expect(evidence.checkedAt).toBe(contract.researchCutoff);
        expect(evidence.title).not.toBe('');
        expect(evidence.finding).not.toBe('');
      }

      if (route.unknownFinding) {
        expect(route.unknownFinding.checkedAt).toBe(contract.researchCutoff);
        expect(route.unknownFinding.finding).not.toBe('');
        expect(route.unknownFinding.safeConsequence).not.toBe('');
      }
    }
  });

  it('freezes a no-secret, no-provider-write, no-connection-award boundary', () => {
    expect(contract.globalContract.credentialBoundary).toEqual({
      accountSecrets: 'supabase-vault-only',
      assistantContext: 'none',
      broadcastPayloads: 'none',
      browserStorage: 'none',
      durableMemory: 'none',
      logs: 'none',
      sharedRecords: 'none',
    });
    expect(contract.globalContract.heroRule).toContain('Provider presence never awards XP');
    expect(contract.routes.every(route => route.authentication.writesAllowed === false)).toBe(true);
    expect(contract.routes.find(route => route.provider === 'barclays')?.heroMapping.reason).toBe('none-on-import');
    expect(contract.routes.find(route => route.provider === 'iphone-movement')?.heroMapping.status).toBe('blocked-pending-explicit-threshold-approval');
    expect(contract.routes.find(route => route.provider === 'elif-b')?.capabilityFinding).toBe('provider-identity-and-api-unknown');
  });
});
