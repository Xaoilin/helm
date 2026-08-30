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
    expect(contractsByProvider.iphone_movement.capabilityStatus).toBe(
      'user_export_supported_native_api_unavailable_to_hosted_web',
    );
    expect(contractsByProvider.elif_b.capabilityStatus).toBe('provider_identity_unknown');
  });

  it('freezes GitHub least privilege and the expiring-token prerequisite', () => {
    expect(contractsByProvider.github.providerPermissions).toEqual([
      { resource: 'metadata', access: 'read' },
      { resource: 'pull_requests', access: 'read' },
    ]);
    expect(contractsByProvider.github.tokenPolicy).toBe(
      'github_user_to_server_expiration_required',
    );
    expect(contractsByProvider.github.acceptedInput).toContain(
      'only after user-to-server token expiration is enabled',
    );
    expect(contractsByProvider.github.dataMinimisation.join(' ')).not.toMatch(/Contents/u);

    for (const contract of LIFE_HERO_PROVIDER_ROUTE_CONTRACTS) {
      if (contract.provider === 'github') continue;
      expect(contract.providerPermissions).toEqual([]);
      expect(contract.tokenPolicy).toBe('not_applicable');
    }
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

  it('maps every provider claim to an exact dated primary source', () => {
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

    const expectedSourceClaims = {
      barclays: {
        'https://www.barclays.co.uk/help/open-banking/what-is-open-banking/': [
          'barclays_open_banking_third_party_sharing',
        ],
        'https://www.barclays.co.uk/help/accounts/statements-balances/print-online-statements/': [
          'barclays_statement_pdf_export',
        ],
        'https://standards.openbanking.org.uk/api-specifications/latest/': [
          'open_banking_api_specification',
        ],
        'https://www.openbanking.org.uk/account-providers/': [
          'open_banking_provider_enrolment',
        ],
      },
      eight_sleep: {
        'https://help.eightsleep.com/en_us/what-data-does-the-eight-sleep-tracker-collect-Hk79MjgUm': [
          'eight_sleep_data_copy_request',
        ],
        'https://www.eightsleep.com/app-terms-conditions/': [
          'eight_sleep_data_handling_terms',
        ],
      },
      elif_b: {},
      iphone_movement: {
        'https://support.apple.com/guide/iphone/share-your-health-data-iph5ede58c3d/26/ios/26': [
          'apple_health_xml_export',
        ],
        'https://developer.apple.com/documentation/healthkit': [
          'apple_healthkit_native_api',
        ],
        'https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data': [
          'apple_healthkit_per_type_authorization',
        ],
        'https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/distancewalkingrunning': [
          'apple_movement_quantity_type',
        ],
      },
      github: {
        'https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app': [
          'github_app_selected_repository_access',
        ],
        'https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app': [
          'github_app_permission_selection',
        ],
        'https://docs.github.com/en/rest/repos/repos': [
          'github_repository_metadata_read_permission',
        ],
        'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app': [
          'github_user_access_token_web_flow',
        ],
        'https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens': [
          'github_user_token_expiration_opt_in',
        ],
        'https://docs.github.com/en/rest/pulls/pulls': [
          'github_pull_request_read_permission',
        ],
        'https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api': [
          'github_rest_rate_limit_handling',
        ],
      },
    } as const;

    for (const contract of LIFE_HERO_PROVIDER_ROUTE_CONTRACTS) {
      const sourceClaims = Object.fromEntries(
        contract.primarySources.map(source => [source.url, source.supports]),
      );

      expect(sourceClaims).toEqual(expectedSourceClaims[contract.provider]);
      for (const source of contract.primarySources) {
        expect(source.checkedAt).toBe('2026-08-30');
        expect(allowedHosts.has(new URL(source.url).hostname)).toBe(true);
        expect(source.supports.length).toBeGreaterThan(0);
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
