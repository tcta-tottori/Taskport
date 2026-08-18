/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_PARSE_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** vite.config.ts の define で埋め込むビルド時刻と版 */
declare const __BUILD_TIME__: string
declare const __APP_VERSION__: string
