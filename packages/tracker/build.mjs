import * as esbuild from 'esbuild'

const options = {
  entryPoints: ['src/script.ts', 'src/replay.ts'],
  outdir: 'dist',
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
  for (const [file, { bytes }] of Object.entries(result.metafile.outputs))
    console.log(`${file} ${bytes} bytes`)
}
