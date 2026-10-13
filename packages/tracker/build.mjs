import * as esbuild from 'esbuild'

const options = {
  entryPoints: ['src/script.ts'],
  outfile: 'dist/script.js',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2018',
  legalComments: 'none',
}

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
} else {
  const result = await esbuild.build({ ...options, metafile: true })
  const bytes = Object.values(result.metafile.outputs)[0].bytes
  console.log(`dist/script.js ${bytes} bytes`)
}
