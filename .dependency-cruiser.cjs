/**
 * Architecture rules (spec "Architecture and harness" → "Rules"). `$1` in a `to` condition
 * refers to the first capture group of the `from.path`: the module name.
 * The rules deliberately overlap (e.g. domain -> infrastructure breaks both `domain-is-pure`
 * and `no-inward-infra`): each one documents a separate invariant.
 *
 * Every rule is an error: `npm run arch` (part of `npm run verify`) fails on any violation.
 * Never weaken a rule to make a check pass; fix the code.
 */
const SEVERITY = 'error';

// Unit tests live next to the code and may import the test runner and test helpers.
const TEST_FILE = '\\.test\\.ts$';
const MODULE = '(?:^|/)modules/([^/]+)/';
const NODE_MODULES = '(?:^|/)node_modules/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      comment:
        'domain imports only its own domain/ and shared-kernel/. No npm packages and no Node built-ins.',
      severity: SEVERITY,
      from: { path: `${MODULE}domain/`, pathNot: TEST_FILE },
      to: { pathNot: [`(?:^|/)modules/$1/domain/`, '(?:^|/)shared-kernel/'] },
    },
    {
      name: 'application-only-domain',
      comment:
        "application imports its own domain/ and application/, shared-kernel/, other modules' index.ts, contracts/, and only the npm packages `diff` and `zod`.",
      severity: SEVERITY,
      from: { path: `${MODULE}application/`, pathNot: TEST_FILE },
      to: {
        pathNot: [
          `(?:^|/)modules/$1/(?:domain|application)/`,
          '(?:^|/)shared-kernel/',
          '(?:^|/)modules/[^/]+/index\\.ts$',
          '(?:^|/)contracts/',
          '(?:^|/)node_modules/(?:diff|zod)/',
        ],
      },
    },
    {
      name: 'no-inward-infra',
      comment: 'domain and application never import infrastructure/, interfaces/ or platform/.',
      severity: SEVERITY,
      from: { path: '(?:^|/)modules/[^/]+/(?:domain|application)/' },
      to: {
        path: '(?:^|/)(?:modules/[^/]+/(?:infrastructure|interfaces)|platform)/',
        pathNot: NODE_MODULES,
      },
    },
    {
      name: 'modules-via-index',
      comment: "a module reaches another module only through that module's public index.ts.",
      severity: SEVERITY,
      from: { path: MODULE },
      to: {
        path: '(?:^|/)modules/[^/]+/',
        pathNot: [`(?:^|/)modules/$1/`, '(?:^|/)modules/[^/]+/index\\.ts$', NODE_MODULES],
      },
    },
    {
      name: 'platform-db-only',
      comment: 'modules import nothing from platform/ except platform/db.ts.',
      severity: SEVERITY,
      from: { path: MODULE },
      to: { path: '(?:^|/)platform/', pathNot: ['(?:^|/)platform/db\\.ts$', NODE_MODULES] },
    },
    {
      name: 'cli-no-server',
      comment:
        'the client CLI (src/cli) talks to the server over HTTP only: it imports neither modules/ nor platform/. Shared types come from contracts/.',
      severity: SEVERITY,
      from: { path: '(?:^|/)cli/' },
      to: { path: '(?:^|/)(?:modules|platform)/', pathNot: NODE_MODULES },
    },
    {
      name: 'contracts-are-leaf',
      comment: 'contracts/ holds HTTP types only and imports nothing outside itself.',
      severity: SEVERITY,
      from: { path: '(?:^|/)contracts/' },
      to: { pathNot: '(?:^|/)contracts/' },
    },
    {
      name: 'shared-kernel-is-pure',
      comment: 'shared-kernel/ is dependency-free and imports nothing outside itself.',
      severity: SEVERITY,
      from: { path: '(?:^|/)shared-kernel/', pathNot: TEST_FILE },
      to: { pathNot: '(?:^|/)shared-kernel/' },
    },
    {
      name: 'llm-sdk-in-adapter',
      comment:
        'the openai SDK is imported only by the OpenAI-compatible adapter in modules/llm/infrastructure; everything else uses the LanguageModel port.',
      severity: SEVERITY,
      from: { pathNot: '(?:^|/)modules/llm/infrastructure/' },
      to: { path: '(?:^|/)node_modules/openai/' },
    },
    {
      name: 'no-circular',
      comment: 'circular dependencies are forbidden.',
      severity: SEVERITY,
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    // Resolves the `.js` specifiers of the ESM sources to their `.ts` files.
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
    },
  },
};
