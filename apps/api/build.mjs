import * as esbuild from 'esbuild'

await esbuild.build({
  // `user` resets passwords inside the container: node dist/user.js password <email>
  entryPoints: { server: 'src/server.ts', migrate: 'src/migrate.ts', user: 'src/users/cli.ts' },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Workspace packages are bundled; third-party dependencies stay in node_modules.
  packages: 'external',
  alias: {
    '@recount/shared': '../../packages/shared/src/index.ts',
    '@recount/semantic': '../../packages/semantic/src/index.ts',
    '@recount/sites': '../../sites/index.ts',
  },
})
