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
        /**
         * [トラブルシューティング・ログ: ビルドファイル名]
         * - エラー: 拡張機能のWebviewが404エラーまたは真っ白になる。
         * - 原因: Viteはデフォルトでファイル名にハッシュ（例: index-x8d.js）を付与するため、拡張機能側（CodeGraphPanel.ts）から固定パスで読み込めなかった。
         * - 解決策: output設定で固定ファイル名（assets/[name].js）を指定し、決定論的にファイルをロードできるようにした。
         */
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      },
    },
  },
})