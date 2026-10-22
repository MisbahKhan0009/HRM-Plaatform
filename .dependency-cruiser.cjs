// Enforces the dependency rules in docs/03-architecture/MONOREPO.md §2. Run: pnpm deps:check
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'web-no-server-code',
      comment: 'apps/web must never import domain, db, auth or mailer (business rules live on the server).',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^packages/(domain|db|auth|mailer)/' },
    },
    {
      name: 'domain-is-pure',
      comment: 'packages/domain does no I/O: only contracts, decimal.js and date libraries.',
      severity: 'error',
      from: { path: '^packages/domain/' },
      to: {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-peer',
          'npm-optional',
          'local',
          'aliased-workspace',
          'aliased',
        ],
        pathNot: [
          '^packages/(domain|contracts)/',
          'node_modules/(decimal\\.js|date-fns|@date-fns|fast-check|vitest|zod)/',
        ],
      },
    },
    {
      name: 'contracts-only-zod',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '^(packages/(?!contracts/)|apps/)' },
    },
    {
      name: 'ui-standalone',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: '^(packages/(?!ui/)|apps/)' },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'no-relative-cross-package',
      comment: 'Import other packages through their entry point (@hrm/x), never by relative path.',
      severity: 'error',
      from: { path: '^(apps|packages)/([^/]+)/' },
      to: { dependencyTypes: ['local'], pathNot: ['^$1/$2/', '^docs/'] },
    },
    {
      name: 'no-unresolvable',
      comment:
        'An import that does not resolve is either a typo or a package the workspace does not declare as a dependency.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true, pathNot: ['^cloudflare:', '^virtual:'] },
    },
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(^|/)(dist|node_modules|\\.wrangler)/|routeTree\\.gen\\.ts$|worker-configuration\\.d\\.ts$',
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'default', 'types'] },
  },
};
