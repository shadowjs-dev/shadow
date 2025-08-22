<img src="https://github.com/jehaad1/ShadowJS/blob/main/banner.png?raw=true" style="width: 100%">

# ShadowJS

ShadowJS is a fast, minimal JSX framework with fine-grained reactivity. It provides a modern, reactive programming model while maintaining excellent performance and a small bundle size.

## ✨ Features

- **🎯 Fine-grained reactivity** - Only re-render what changes
- **⚡ Fast compilation** - Built on SWC for optimal build performance
- **🎨 JSX-first** - Familiar React-like syntax with powerful extensions
- **📦 Small bundle** - Minimal runtime with tree-shaking support
- **🔧 TypeScript ready** - Full TypeScript support out of the box

## 📦 Packages

| Package                                       | Description                             |
| --------------------------------------------- | --------------------------------------- |
| [`@shadow-js/core`](./packages/core/)         | Core reactivity + DOM runtime           |
| [`@shadow-js/compiler`](./packages/compiler/) | JSX transforms for reactive expressions |
| [`@shadow-js/vite`](./packages/vite/)         | Vite plugin for seamless development    |

## 🚀 Quick Start

### 1. Create a new project

```bash
npm create shadow-app my-app
cd my-app
npm install
npm run dev
```

### 2. Manual setup

```bash
npm install @shadow-js/core @shadow-js/vite
```

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
import { useStore, Show, For } from "@shadow-js/core";

function App() {
  const [count, setCount] = useStore(0);
  const [items, setItems] = useStore(["Shadow", "JS", "Reactivity"]);

  return (
    <div>
      <h1>ShadowJS Counter</h1>

      <button onClick={() => setCount((c) => c + 1)}>Count: {count()}</button>

      <Show when={count() > 5} fallback={<p>Keep clicking!</p>}>
        <p>🎉 You reached {count()}!</p>
      </Show>

      <ul>
        <For each={items()}>{(item) => <li>{item}</li>}</For>
      </ul>
    </div>
  );
}
```

## 🎯 Core Concepts

### Reactive Stores

```jsx
import { useStore } from "@shadow-js/core";

function Counter() {
  const [count, setCount] = useStore(0);

  return <button onClick={setCount((c) => c + 1)}>{count()}</button>;
}
```

### Conditional Rendering

```tsx
import { Show } from "@shadow-js/core";

function UserStatus({ user }) {
  return (
    <Show when={user()} fallback={<div>Please log in</div>}>
      <div>Welcome, {user().name}!</div>
    </Show>
  );
}
```

### Lists with For

```jsx
import { For } from "@shadow-js/core";

function TodoList({ todos }) {
  return (
    <ul>
      <For each={todos()}>{(todo, index) => <li>{todo.title}</li>}</For>
    </ul>
  );
}
```

### Effects and Lifecycle

```jsx
import { useEffect, onMount } from "@shadow-js/core";

function Timer() {
  const [time, setTime] = useStore(new Date());

  onMount(() => {
    console.log("Component mounted");
  });

  const interval = setInterval(() => {
    setTime(new Date());
  }, 1000);

  return <h1>Current time: {time().toLocaleTimeString()}</h1>;
}
```

## 🏗️ Project Structure

```
ShadowJS/
├── packages/
│   ├── core/          # Core framework
│   │   ├── src/
│   │   │   ├── reactivity/ # Reactive system
│   │   │   ├── runtime/    # DOM runtime & components
│   │   │   └── index.ts    # Public API
│   ├── compiler/           # JSX transformations
│   ├── vite/              # Vite integration
└── turbo.json           # Build configuration
```

## 🛠️ Development

### Monorepo commands

```bash
# Install dependencies
npm ci

# Build all packages
npm run build

# Type checking
npm run typecheck

# Linting
npm run lint

# Code formatting
npm run format
npm run format:check

# Create a changeset for release
npx changeset
```

### Package development

```bash
# Watch mode for a specific package
cd packages/core
npm run dev

# Test changes in playground
cd playground
npm run dev
```

## 📚 Documentation

- [API Reference](./packages/core/README.md) - Complete API documentation
- [Contributing](./CONTRIBUTING.md) - How to contribute to ShadowJS

## 🤝 Contributing

We welcome any contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Run `npm run typecheck && npm run lint`
5. Create a changeset: `npx changeset`
6. Push your branch and create a Pull Request

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

ShadowJS is inspired by modern reactive frameworks and aims to provide the best of both worlds: the familiarity of JSX with the performance of fine-grained reactivity.

---

Built by Jehaad AL-Johani using TypeScript, SWC, and modern web standards.
