import { readdir, stat, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from '@swc/core'

async function* scan(pathname) {
  const entries = await readdir(pathname)
  for (const entry of entries) {
    const stats = await stat(join(pathname, entry))
    if (stats.isDirectory()) {
      yield* scan(join(pathname, entry))
      continue
    }

    yield join(pathname, entry)
  }
}

async function bootstrap() {
  const sourceRoot = 'src'
  const outDir = 'dist'

  await rm(join(fileURLToPath(import.meta.url), '..', outDir), {
    recursive: true,
    force: true
  })

  for await (const entry of scan(sourceRoot)) {
    const source = await readFile(entry, 'utf-8')

    {
      const { code } = await transform(source, {
        jsc: {
          baseUrl: join(fileURLToPath(import.meta.url), '..'),
          parser: {
            syntax: 'ecmascript'
          },

          target: 'es2020',
          keepClassNames: true,

          paths: {
            '#/*': ['./src/*']
          }
        },
        module: {
          type: 'es6',
          strict: true,
          importInterop: 'swc'
        }
      })

      const dir = dirname(entry)

      await mkdir(dir.replace(sourceRoot, join(outDir, 'esm')), {
        recursive: true
      })

      await writeFile(
        join(
          fileURLToPath(import.meta.url),
          '..',
          entry.replace(sourceRoot, join(outDir, 'esm'))
        ),
        code
      )
    }

    {
      const { code } = await transform(source, {
        jsc: {
          baseUrl: join(fileURLToPath(import.meta.url), '..'),
          parser: {
            syntax: 'ecmascript'
          },

          target: 'es2020',
          keepClassNames: true,

          paths: {
            '#/*': ['./src/*']
          }
        },
        module: {
          type: 'commonjs',
          strict: true,
          importInterop: 'swc'
        }
      })

      const dir = dirname(entry)

      await mkdir(dir.replace(sourceRoot, join(outDir, 'cjs')), {
        recursive: true
      })

      await writeFile(
        join(dir.replace(sourceRoot, join(outDir, 'cjs')), 'package.json'),
        JSON.stringify({ type: 'commonjs' }, null, 2)
      )

      await writeFile(
        join(
          fileURLToPath(import.meta.url),
          '..',
          entry.replace(sourceRoot, join(outDir, 'cjs'))
        ),
        code
      )
    }
  }
}

bootstrap()
