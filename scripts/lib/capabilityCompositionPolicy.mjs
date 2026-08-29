import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const FORBIDDEN_IDENTIFIERS = [
  'AppContextAPI',
  'AppServiceBag',
  'AppServices',
  'ApplicationServices',
  'ServiceLocator',
  'useApp',
  'useServiceLocator',
  'useServices',
];

const WORKFLOW_BOUNDARY_NAME = /(Assistant|Bridge|Chat|DashboardFocus|GoogleSync|LLM|Navigation|Removal|Sync|Undo|Workflow|Coordinator)/u;
const GLOBAL_BAG_NAME = /^(App|Application|Global|Root).*(API|Capabilities|Context|Services|Store)$/u;
const DOMAIN_PROPERTIES = [
  ['assistant', /^(assistant|corrections|recordAssistant|upsertAssistant|noteAssistant)/u],
  ['calendar', /^(calendar|addCalendar|updateCalendar|removeCalendar|bulkUpsertCalendar|bulkRemoveCalendar|setPrimaryCalendar)/u],
  ['chat', /^(conversations|activeConversation|createConversation|sendMessage|deleteConversation|renameConversation)/u],
  ['clock', /^(clock|createStopwatch|createTimer|startStopwatch|startTimer|pauseStopwatch|pauseTimer|resetStopwatch|resetTimer)/u],
  ['finance', /^(finance|transactions|savingsGoals|addTransaction|removeTransaction|addSavings|updateSavings)/u],
  ['gamification', /^(gamification|updateGamification|backfillPrayer)/u],
  ['health', /^(fastFood|addFastFood|updateFastFood|removeFastFood)/u],
  ['inventory', /^(inventory|addInventory|updateInventory|adjustInventory|archiveInventory|completeInventory)/u],
  ['knowledge', /^(knowledge|lifestyle|addKnowledge|updateKnowledge|removeKnowledge|addLifestyle|updateLifestyle)/u],
  ['prayer', /^(prayer|completePrayer|undoPrayer)/u],
  ['projects', /^(projects|projectPages|addProject|updateProject|removeProject|setProject|reorderProject)/u],
  ['settings', /^(settings|integrations|updateSettings|updateIntegration)/u],
  ['tasks', /^(tasks|addTask|updateTask|removeTask|setTasks)/u],
  ['trips', /^(trips|tripLegs|tripItinerary|tripBookings|tripBudget|addTrip|updateTrip|removeTrip)/u],
];

function domainCount(propertyNames) {
  const domains = new Set();
  for (const propertyName of propertyNames) {
    for (const [domain, pattern] of DOMAIN_PROPERTIES) {
      if (pattern.test(propertyName)) domains.add(domain);
    }
  }
  return domains.size;
}

function memberNames(members) {
  return members
    .map(member => member.name)
    .map(name => (
      name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
        ? name.text
        : null
    ))
    .filter(Boolean);
}

export function evaluateCapabilityCompositionSources(sources) {
  const failures = [];

  for (const [path, source] of Object.entries(sources)) {
    if (path.endsWith('/store/AppContext.tsx') || path === 'src/store/AppContext.tsx') {
      failures.push(`${path} recreates the retired all-domain AppContext module.`);
    }

    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      if (new RegExp(`\\b${identifier}\\b`, 'u').test(source)) {
        failures.push(`${path} uses forbidden application service-locator identifier ${identifier}.`);
      }
    }

    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function inspect(node) {
      let name = null;
      let properties = [];
      let isDeclaredContract = false;

      if (ts.isInterfaceDeclaration(node)) {
        name = node.name.text;
        properties = memberNames(node.members);
        isDeclaredContract = true;
      } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
        name = node.name.text;
        properties = memberNames(node.type.members);
        isDeclaredContract = true;
      } else if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && ts.isObjectLiteralExpression(node.initializer)
      ) {
        name = node.name.text;
        properties = memberNames(node.initializer.properties);
      }

      const domains = domainCount(properties);
      if (
        name
        && domains >= 4
        && (isDeclaredContract || GLOBAL_BAG_NAME.test(name))
        && !WORKFLOW_BOUNDARY_NAME.test(name)
      ) {
        failures.push(`${path} declares broad ${name} across ${domains} domains without a workflow-shaped boundary.`);
      }

      ts.forEachChild(node, inspect);
    }

    inspect(sourceFile);
  }

  return {
    failures: [...new Set(failures)],
    ok: failures.length === 0,
  };
}

export function readCapabilityCompositionSources(rootDir) {
  const sourceRoot = join(rootDir, 'src');
  const sources = {};

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'test') visit(absolutePath);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue;
      sources[relative(rootDir, absolutePath)] = readFileSync(absolutePath, 'utf8');
    }
  }

  visit(sourceRoot);
  return sources;
}
