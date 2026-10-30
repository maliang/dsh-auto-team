import { defineConfig } from 'tsdown'

/**
 * client 半构建：产出 `lib/client.js`。
 *
 * 宿主浏览器端不是按 ESM 导入 client 产物，而是执行它、期待它调用
 * `window.__ModuleLoader__.load({ id, factory })` 并从 factory 返回
 * `{ apply, inject }`（形状照本机已装样本 dsh-plugin-teamflow/lib/client.js）。
 * 因此这里用 CJS 产物 + banner/footer 手工套壳。
 *
 * banner 里的 `typeof window` 守卫是刻意加的：
 * ① 使 `node --input-type=module -e "await import('./lib/client.js')"` 退出码为 0
 *    （AC-8 要求两产物都可被 node 加载；无守卫时 `window` 未定义会直接抛错）；
 * ② 非浏览器环境（测试、SSR 预检）不会崩。
 */
const header = `if (typeof window !== "undefined" && window.__ModuleLoader__) {
window.__ModuleLoader__.load({
  id: "dsh-auto-team",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
`

const footer = `
    return module.exports;
  },
});
}
`

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  external: ['react'],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: header,
    footer,
  },
})
