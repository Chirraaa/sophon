import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { build, type Plugin } from 'vite'

function visualReactRuntime(): Plugin {
  const id = 'virtual:sophon-visual-react'
  return {
    name: 'sophon-visual-react',
    resolveId: (source) => (source === id ? '\0' + id : undefined),
    async load(source) {
      if (source !== '\0' + id) return
      const entry = resolve('src/visual/react.ts')
      this.addWatchFile(entry)
      const result = await build({
        configFile: false,
        logLevel: 'silent',
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: {
          write: false,
          minify: true,
          lib: { entry, name: 'SophonVisualReact', formats: ['iife'] }
        }
      })
      const output = Array.isArray(result) ? result[0] : result
      if (!('output' in output)) throw new Error('Visual React bundle was not generated.')
      const chunk = output.output.find((item) => item.type === 'chunk')
      if (!chunk) throw new Error('Visual React bundle is empty.')
      return 'export default ' + JSON.stringify(chunk.code)
    }
  }
}

export default defineConfig({
  main: { plugins: [visualReactRuntime(), externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          parser: resolve('src/renderer/parser.html')
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml: (html) =>
          html
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace("connect-src 'none'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
      }
    ]
  }
})
