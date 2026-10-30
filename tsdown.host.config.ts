import { defineConfig } from 'tsdown'

/**
 * 宿主半构建：产出 `lib/index.js`（ESM）。
 *
 * 顶层只做声明与装配：不得在模块顶层访问 `ctx.*`、不得 `throw`
 * （AC-8：`node --input-type=module -e "await import('./lib/index.js')"` 必须退出码 0，
 *  且宿主未注入服务时不能把进程带崩）。
 */
export default defineConfig({
  entry: { index: 'src/host/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: false,
  outputOptions: {
    entryFileNames: 'index.js',
  },
})
