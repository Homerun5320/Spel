// Minimal typing of the Vite constant used by src/app/paths.ts (tsconfig "types" is ["node"] on purpose).
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}
