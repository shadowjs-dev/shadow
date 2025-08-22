# ShadowJS Vite Plugin

[![npm version](https://img.shields.io/npm/v/@shadow-js/vite.svg)](https://www.npmjs.com/package/@shadow-js/vite)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Vite plugin for ShadowJS that provides seamless development experience with hot reload, JSX compilation, and optimized build process.

## ✨ Features

- **⚡ Hot Module Replacement**: Instant updates during development
- **🎯 JSX Compilation**: Automatic ShadowJS JSX transformations
- **🔧 Zero Configuration**: Works out of the box with sensible defaults
- **🎨 TypeScript Support**: Full TypeScript and TSX compilation
- **📦 Optimized Builds**: Production-ready bundle optimization
- **🔍 Source Maps**: Accurate debugging with source map support
- **🎭 Development Server**: Fast development server with HMR
- **📱 Modern Standards**: ES2022+ with modern browser support

## 📦 Installation

```bash
npm install @shadow-js/vite
```

Install together with ShadowJS:

```bash
npm install @shadow-js/core @shadow-js/vite
```

## 🚀 Quick Start

### Basic Setup

**vite.config.ts**

```typescript
import { defineConfig } from "vite";
import shadow from "@shadow-js/vite";

export default defineConfig({
  plugins: [shadow()],
});
```

**src/App.tsx**

```jsx
import { useStore, Show } from "@shadow-js/core";

function App() {
  const [count, setCount] = useStore(0);

  return (
    <div>
      <h1>ShadowJS Counter</h1>
      <button onClick={() => setCount((c) => c + 1)}>Count: {count()}</button>
      <Show when={count() > 5}>
        <p>🎉 You reached {count()}!</p>
      </Show>
    </div>
  );
}

export default App;
```

**src/main.ts**

```typescript
import { render } from "@shadow-js/core";
import App from "./App";

render(App, document.getElementById("app")!);
```

**index.html**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ShadowJS App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🎯 How It Works

The plugin integrates ShadowJS with Vite's build pipeline:

### 1. Development Mode

- **Hot Module Replacement**: Instant updates without page refresh
- **Source Maps**: Accurate debugging information
- **Error Overlay**: Clear error messages in browser

### 2. Build Process

- **JSX Compilation**: Transforms TSX/JSX using ShadowJS compiler
- **TypeScript Compilation**: Converts TypeScript to JavaScript
- **JSX Runtime Injection**: Automatically imports ShadowJS runtime
- **Code Splitting**: Optimizes bundle size with code splitting
- **Minification**: Production-ready code minification

### 3. Plugin Architecture

```
Source Code (.tsx)
    ↓
ShadowJS Compiler (JSX → Reactive)
    ↓
SWC (TypeScript → JavaScript)
    ↓
Vite (Bundling & Optimization)
    ↓
Output Bundle
```

## 🔧 Configuration

### Basic Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import shadow from "@shadow-js/vite";

export default defineConfig({
  plugins: [shadow()],
  // Your other Vite configuration
});
```

### Advanced Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import shadow from "@shadow-js/vite";

export default defineConfig({
  plugins: [
    shadow({
      // Plugin-specific options (future)
    }),
  ],

  // Vite configuration
  server: {
    port: 3000,
    open: true,
  },

  build: {
    target: "es2022",
    minify: "esbuild",
  },

  // TypeScript configuration
  esbuild: {
    // Vite handles TypeScript compilation
  },
});
```

### With Other Vite Plugins

The ShadowJS plugin works well with other Vite plugins:

```typescript
import { defineConfig } from "vite";
import shadow from "@shadow-js/vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    shadow(),
    viteStaticCopy({
      targets: [
        {
          src: "static/*",
          dest: "assets",
        },
      ],
    }),
  ],
});
```

## 🏗️ Plugin Architecture

### Core Components

| Component              | Description                                   |
| ---------------------- | --------------------------------------------- |
| **JSX Transform**      | Converts ShadowJS JSX to reactive expressions |
| **TypeScript Support** | Handles TypeScript compilation via SWC        |
| **HMR Integration**    | Manages hot module replacement                |
| **Source Maps**        | Generates source maps for debugging           |
| **Error Handling**     | Provides clear error messages                 |

### Transformation Pipeline

1. **File Detection**: Identifies `.tsx` and `.jsx` files
2. **ShadowJS Compilation**: Applies JSX transformations
3. **SWC Processing**: Handles TypeScript/JSX to JavaScript conversion
4. **Runtime Injection**: Adds necessary ShadowJS imports
5. **Source Map Generation**: Creates debugging source maps

### Development Features

- **Fast Refresh**: Instant updates during development
- **Error Boundaries**: Development-friendly error handling
- **Console Integration**: Clear logging and debugging messages
- **Type Checking**: Real-time TypeScript error reporting

## 🎨 Development Experience

### Hot Module Replacement

The plugin provides seamless HMR for ShadowJS components:

```jsx
// This component will hot-reload automatically
function Counter() {
  const [count, setCount] = useStore(0);

  return <button onClick={() => setCount((c) => c + 1)}>{count()}</button>;
}
```

### TypeScript Integration

Full TypeScript support with IntelliSense:

```tsx
// TypeScript types work perfectly
function UserComponent({ user }: { user: User }) {
  const [isEditing, setIsEditing] = useStore(false);

  return (
    <div>
      <h2>{user().name}</h2>
      <button onClick={() => setIsEditing((v) => !v)}>
        {isEditing() ? "Cancel" : "Edit"}
      </button>
    </div>
  );
}
```

## 🤝 Contributing

We welcome any contributions! See the [Contributing Guide](../../CONTRIBUTING.md) for details.

Areas for contribution:

- Performance optimizations
- New plugin features
- Better error messages
- Enhanced TypeScript support
- Additional build optimizations

## 📄 License

MIT License - see [LICENSE](../../LICENSE) for details.

## 📞 Support

- **Documentation**: [Vite Plugin Guide](../../packages/vite/README.md)
- **Examples**: [Integration Examples](../../documentation/examples.md)
- **Issues**: [GitHub Issues](https://github.com/shadowjs-dev/shadow/issues)
- **Discussions**: [GitHub Discussions](https://github.com/shadowjs-dev/shadow/discussions)

---

Built by Jehaad AL-Johani for the ShadowJS ecosystem.
