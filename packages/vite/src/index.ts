import type { PluginOption } from "vite";
import { transformSource } from "@shadow-js/compiler";
import { transform as swcTransform } from "@swc/core";

/**
 * Shadow Vite Plugin
 *
 * This plugin integrates Shadow with Vite to provide seamless development experience.
 * It handles the complete transformation pipeline from TSX/JSX source code to
 * Shadow-compatible JavaScript with reactive expressions.
 *
 * Plugin Pipeline:
 * 1. **Shadow Compiler**: Applies JSX transformations to inject reactive functions
 * 2. **SWC Transformation**: Converts TypeScript/JSX to JavaScript with proper imports
 * 3. **JSX Runtime Injection**: Automatically imports Shadow's JSX runtime functions
 * 4. **Source Map Generation**: Preserves debugging capabilities
 *
 * Features:
 * - **Selective Processing**: Only transforms user code (excludes node_modules)
 * - **TypeScript Support**: Full TypeScript and TSX compilation
 * - **Hot Module Replacement**: Compatible with Vite's HMR system
 * - **Error Handling**: Provides clear error messages for compilation failures
 * - **Performance**: Uses fast SWC compiler for optimal build speeds
 *
 * The plugin automatically configures Vite to preserve JSX for SWC processing
 * instead of using esbuild's JSX transform, ensuring compatibility with Shadow's
 * reactive programming model.
 *
 * @returns Vite PluginOption instance for Shadow integration
 *
 * @example
 * ```typescript
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import shadow from "@shadow-js/vite";
 *
 * export default defineConfig({
 *   plugins: [shadow()]
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Your component file (App.tsx)
 * import { useStore, Show } from "@shadow-js/core";
 *
 * function App() {
 *   const [count, setCount] = useStore(0)
 *
 *   return (
 *     <div>
 *       <button onClick={() => setCount((c) => c + 1)}>
 *         Increment
 *       </button>
 *       <Show when={count() > 0}>
 *         <div>Count: {count()}</div>
 *       </Show>
 *     </div>
 *   )
 * }
 * ```
 */
export default function shadow(): PluginOption {
  return {
    name: "@shadow-js/vite",
    enforce: "pre",

    // Prevent esbuild from also transforming JSX to avoid double transforms.
    config() {
      return {
        esbuild: {
          jsx: "preserve",
        },
      };
    },

    async transform(code, id) {
      // Only TSX/JSX user files
      if (!/\.(tsx|jsx)$/.test(id)) return null;
      if (id.includes("node_modules")) return null;

      // 1) Apply Shadow compiler transforms on source text
      let transformedCode: string;
      try {
        transformedCode = transformSource(code);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`ShadowJS (vite): compiler failed for ${id}: ${msg}`);
      }

      // 2) Use SWC to handle TS/JSX -> JS and inject jsx runtime imports
      try {
        const result = await swcTransform(transformedCode, {
          filename: id,
          jsc: {
            parser: { syntax: "typescript", tsx: true },
            transform: {
              react: {
                runtime: "automatic",
                importSource: "@shadow-js/core",
              },
            },
            target: "es2022",
          },
          module: { type: "es6" },
          sourceMaps: true,
        });

        return {
          code: result.code,
          map: result.map ?? null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`ShadowJS (vite): SWC failed for ${id}: ${msg}`);
      }
    },
  } satisfies PluginOption;
}
