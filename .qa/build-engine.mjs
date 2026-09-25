// QA 辅助：用 esbuild 打包 engine.js，把 Vite 特有的 `?raw` 导入替换为空字符串
// 使 engine.js 可在 node 环境直测（echartsSource 仅用于 exportReportHTML 内嵌脚本，不影响被测函数）
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(root, 'src/engine.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: path.join(root, '.qa/engine.bundle.mjs'),
  external: ['xlsx'],
  plugins: [{
    name: 'raw-stub',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, args => ({ path: args.path, namespace: 'raw-stub' }))
      build.onLoad({ filter: /.*/, namespace: 'raw-stub' }, () => ({ contents: 'export default ""', loader: 'js' }))
    },
  }],
  logLevel: 'warning',
})
console.log('BUNDLE_OK')
