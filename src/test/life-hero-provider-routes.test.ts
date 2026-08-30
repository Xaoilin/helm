import { describe, expect, it } from 'vitest';
import { LIFE_HERO_PROVIDER_ROUTE_CONTRACTS } from '../types/lifeHeroProviderRoutes';

const contractsByProvider = Object.fromEntries(
  LIFE_HERO_PROVIDER_ROUTE_CONTRACTS.map(contract => [contract.provider, contract]),
);

describe('Life Hero external evidence route contracts', () => {
  it('freezes exactly one later-ticket owner and route for every named provider', () => {
    expect(LIFE_HERO_PROVIDER_ROUTE_CONTRACTS.map(contract => [
      contract.provider,
      contract.ownerTicket,
      contract.route,
    ])).toEqual([
      ['barclays', 'KAN-265', 'barclays_statement_import'],
      ['eight_sleep', 'KAN-267', 'eight_sleep_data_export_import'],
      ['elif_b', 'KAN-268', 'elif_b_manual_confirmation'],
      ['iphone_movement', 'KAN-266', 'apple_health_xml_import'],
      ['github', 'KAN-264', 'github_app_read_only'],
    ]);
  });

  it('permits automatic trusted evidence only for the documented GitHub App route', () => {
    const automatic = LIFE_HERO_PROVIDER_ROUTE_CONTRACTS.filter(
      contract => contract.automation === 'read_only_automatic',
    );

    expect(automatic).toHaveLength(1);
    expect(automatic[0]).toMatchObject({
      provider: 'github',
      capabilityStatus: 'supported_read_only',
      sourceTier: 'trusted_integration',
      authenticationBoundary: 'provider_authorization_server_exchange',
      secretBoundary: 'supabase_vault_server_only',
    });
    expect(contractsByProvider.barclays.sourceTier).toBe('self_reported');
    expect(contractsByProvider.eight_sleep.sourceTier).toBe('self_reported');
    expect(contractsByProvider.iphone_movement.sourceTier).toBe('self_reported');
    expect(contractsByProvider.elif_b.capabilityStatus).toBe('provider_identity_unknown');
  });

  it('keeps unknown capability explicit and all routes fail closed', () => {
    for (const contract of LIFE_HERO_PROVIDER_ROUTE_CONTRACTS) {
      expect(contract.failureBehavior).toMatch(/award nothing|create no award|creates no award/u);
      expect(contract.safeFallback.length).toBeGreaterThan(20);
      expect(contract.dataMinimisation.length).toBeGreaterThanOrEqual(2);
      expect(contract.provenance.length).toBeGreaterThanOrEqual(2);
      expect(contract.costAndPrerequisites.length).toBeGreaterThanOrEqual(2);
      expect(contract.requiredTests.length).toBeGreaterThanOrEqual(4);
    }

    expect(contractsByProvider.eight_sleep.acceptedInput).toContain('current schema is unknown');
    expect(contractsByProvider.elif_b.primarySources).toEqual([]);
    expect(contractsByProvider.elif_b.costAndPrerequisites.join(' ')).toContain('unknown');
  });

  it('dates every cited primary source and keeps it on the official publisher host', () => {
    const allowedHosts = new Set([
      'www.barclays.co.uk',
      'standards.openbanking.org.uk',
      'www.openbanking.org.uk',
      'help.eightsleep.com',
      'www.eightsleep.com',
      'support.apple.com',
      'developer.apple.com',
      'docs.github.com',
    ]);

    for (const contract of LIFE_HERO_PROVIDER_ROUTE_CONTRACTS) {
      for (const source of contract.primarySources) {
        expect(source.checkedAt).toBe('2026-08-30');
        expect(allowedHosts.has(new URL(source.url).hostname)).toBe(true);
      }
    }
  });

  it('freezes bounded evidence semantics without quantity-based XP', () => {
    expect(contractsByProvider.barclays.qualifyingRule).toContain('never award XP');
    expect(contractsByProvider.eight_sleep.qualifyingRule).toContain('never change XP');
    expect(contractsByProvider.elif_b.qualifyingRule).toContain('never change XP');
    expect(contractsByProvider.iphone_movement.qualifyingRule).toContain('never change XP');
    expect(contractsByProvider.github.qualifyingRule).toContain('never change XP');

    expect(contractsByProvider.barclays.evidenceKind).toBe('financial_progress');
    expect(contractsByProvider.eight_sleep.evidenceKind).toBe('vitality_activity');
    expect(contractsByProvider.elif_b.evidenceKind).toBe('knowledge_learning');
    expect(contractsByProvider.iphone_movement.evidenceKind).toBe('vitality_activity');
    expect(contractsByProvider.github.evidenceKind).toBe('craft_practice');
  });
});
