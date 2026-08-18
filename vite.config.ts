import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages のサブパス。リポジトリ名（Taskport）と完全に一致させる。
// https://tcta-tottori.github.io/Taskport/
const BASE = '/Taskport/'

export default defineConfig({
  base: BASE,
  // ビルド時刻を埋め込む（設定画面で「最終更新」として表示し、デプロイ確認に使う）
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // 直したその日に反映させたいので自動更新（skipWaiting + clientsClaim）。
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/favicon-48.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Taskport — タスク・スケジュール管理',
        short_name: 'Taskport',
        description:
          'タスクとスケジュールを、どの端末からでも・どんな方法でも入れられて、必要な形で出せる個人用ハブ。',
        lang: 'ja',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'portrait',
        start_url: BASE,
        scope: BASE,
        background_color: '#17181b',
        theme_color: '#17181b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 他アプリ（Gmail / LINE / ブラウザ）の共有メニューから本文を投げ込む入口。
        // GET なので ?title=&text=&url= 付きで /taskport/share へ遷移し、
        // SPA 側（useShareTarget）が受け取って構造化パイプラインへ渡す。
        share_target: {
          action: `${BASE}share`,
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        shortcuts: [
          { name: '音声で追加', short_name: '音声', url: `${BASE}?dock=voice` },
          { name: '今日の予定', short_name: '今日', url: `${BASE}?view=schedule` },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff2}'],
        // /taskport/share も index.html に落として SPA で処理する
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
