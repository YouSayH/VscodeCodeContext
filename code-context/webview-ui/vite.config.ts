import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Extensionのdistフォルダに直接出力する設定
    // ※ 注意: バックエンドのビルド(esbuild)と競合しないよう、
    //   assetsフォルダの中に整理して出力します。
    outDir: '../dist', 
    emptyOutDir: false, // dist内の extension.js を消さないようにする
    rollupOptions: {
      output: {
        // ハッシュ値を付与せず、固定ファイル名にする
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
})