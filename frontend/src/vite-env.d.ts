/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Parlo API, e.g. http://localhost:8200 */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
