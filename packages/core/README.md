# ShadowJS Core Framework

[![npm version](https://img.shields.io/npm/v/core.svg)](https://www.npmjs.com/package/@shadow-js/core)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The core ShadowJS framework providing fine-grained reactivity, JSX runtime, and essential UI components.

## ✨ Features

- **🎯 Fine-grained Reactivity**: Only re-render what actually changes
- **⚡ Fast Runtime**: Minimal overhead with optimized DOM updates
- **🎨 JSX-First**: Familiar React-like syntax with powerful extensions
- **📦 Tree-Shakable**: Only bundle what you use
- **🔧 TypeScript Ready**: Full type safety and IntelliSense support
- **🎭 Component System**: Built-in components for common UI patterns

## 📦 Installation

```bash
npm install @shadow-js/core
```

For development with hot reload and JSX compilation:

```bash
npm install @shadow-js/core @shadow-js/vite
```

## 🚀 Quick Start

```tsx
import { useStore, Show, For } from "@shadow-js/core";

function Counter() {
  const [count, setCount] = useStore(0);
  const [items, setItems] = useStore(["Shadow", "JS", "Reactivity"]);

  return (
    <div>
      <h2>Counter: {() => count()}</h2>
      <button onClick={() => setCount(count() + 1)}>Increment</button>

      <Show when={() => count() > 5} fallback={<p>Keep clicking!</p>}>
        <p>🎉 You reached {() => count()}!</p>
      </Show>

      <ul>
        <For each={() => items()}>{(item) => <li>{() => item}</li>}</For>
      </ul>
    </div>
  );
}
```

## 🎯 Core Concepts

### Reactive Stores

Create reactive state that automatically updates dependent computations:

```tsx
import { useStore } from "@shadow-js/core";

function App() {
  const [count, setCount] = useStore(0);
  const doubled = () => count() * 2; // Reactive computation

  return (
    <div>
      <p>Count: {() => count()}</p>
      <p>Doubled: {() => doubled()}</p> {/* Updates automatically */}
      <button onClick={() => setCount(count() + 1)}>+</button>
    </div>
  );
}
```

### Effects and Lifecycle

```tsx
import { useEffect, onMount, onCleanup } from "@shadow-js/core";

function Timer() {
  const [time, setTime] = useStore(new Date());

  onMount(() => {
    console.log("Component mounted");
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    // Cleanup on unmount or dependency change
    return () => clearInterval(interval);
  });

  onCleanup(() => {
    console.log("Component unmounting");
  });

  return <div>Current time: {() => time().toLocaleTimeString()}</div>;
}
```

### Conditional Rendering

```tsx
import { Show } from "@shadow-js/core";

function UserStatus({ user }) {
  return (
    <Show when={() => user()} fallback={<div>Please log in</div>}>
      <div>Welcome back, {() => user().name}!</div>
    </Show>
  );
}
```

### Lists with For

```tsx
import { For } from "@shadow-js/core";

function TodoList({ todos }) {
  return (
    <ul>
      <For each={() => todos()}>
        {(todo, index) => (
          <li>
            {() => index() + 1}. {() => todo.title}
          </li>
        )}
      </For>
    </ul>
  );
}
```

### Switch/Case Pattern

```tsx
import { Switch, Match } from "@shadow-js/core";

function StatusDisplay({ status }) {
  return (
    <Switch fallback={<div>Unknown status</div>}>
      <Match when={() => status() === "loading"}>
        <div>Loading...</div>
      </Match>
      <Match when={() => status() === "success"}>
        <div>Success!</div>
      </Match>
      <Match when={() => status() === "error"}>
        <div>Error occurred</div>
      </Match>
    </Switch>
  );
}
```

### Async Operations with Suspense

```tsx
import { Suspense, lazy } from "@shadow-js/core";

// Lazy load components
const LazyComponent = lazy(() => import("./HeavyComponent"));

function App() {
  return (
    <Suspense fallback={<div>Loading component...</div>}>
      <LazyComponent />
    </Suspense>
  );
}
```

## 📚 API Reference

### Reactivity Hooks

| Hook                        | Description                               |
| --------------------------- | ----------------------------------------- |
| `useStore<T>(initialValue)` | Create a reactive store                   |
| `useEffect(fn, deps?)`      | Run side effects when dependencies change |
| `useMemo<T>(fn, deps?)`     | Memoize expensive computations            |
| `useId()`                   | Generate unique IDs                       |
| `onMount(fn)`               | Run code when component mounts            |
| `onCleanup(fn)`             | Run cleanup code when component unmounts  |

### Control Flow Components

| Component         | Description                                |
| ----------------- | ------------------------------------------ |
| `<Show>`          | Conditional rendering with fallback        |
| `<For>`           | Render lists with automatic key management |
| `<Switch>`        | Multiple conditional rendering             |
| `<Match>`         | Case condition for Switch                  |
| `<Suspense>`      | Handle async operations                    |
| `<ErrorBoundary>` | Catch and handle errors                    |

### Utilities

| Utility                        | Description                               |
| ------------------------------ | ----------------------------------------- |
| `createContext<T>()`           | Create a context for dependency injection |
| `useContext<T>(context)`       | Consume context values                    |
| `lazy<T>(importFn)`            | Lazy load components                      |
| `render(component, container)` | Render component to DOM                   |
| `Fragment`                     | Group elements without wrapper            |

## 🔧 Advanced Usage

### Custom Hooks

```tsx
import { useStore, useEffect } from "@shadow-js/core";

function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useStore<T>(() => {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(storedValue()));
    } catch (error) {
      console.warn(`Error saving to localStorage:`, error);
    }
  });

  return [storedValue, setStoredValue] as const;
}
```

### Context and Global State

```tsx
import { createContext, useContext } from "@shadow-js/core";

const ThemeContext = createContext();

function ThemeProvider({ children }) {
  const [theme, setTheme] = useStore<"light" | "dark">("light");

  const toggleTheme = () => {
    setTheme(theme() === "light" ? "dark" : "light");
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
```

### Error Boundaries

```tsx
import { ErrorBoundary } from "@shadow-js/core";

function App() {
  return (
    <ErrorBoundary fallback={(error) => <div>Error: {error.message}</div>}>
      <ComponentThatMightError />
    </ErrorBoundary>
  );
}
```

## 🔌 Integration

### Vite Plugin

For the best development experience, use the ShadowJS Vite plugin:

**vite.config.ts**

```typescript
import { defineConfig } from "vite";
import shadow from "@shadow-js/vite";

export default defineConfig({
  plugins: [shadow()],
});
```

### Manual JSX Setup

If you prefer manual setup, configure your bundler to use ShadowJS JSX runtime:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@shadow-js/core"
  }
}
```

## 🎨 Styling

ShadowJS works with any CSS solution:

```tsx
// Inline styles (reactive)
<div style={() => ({ color: theme() === "dark" ? "white" : "black" })}>
  Dynamic styling
</div>

// CSS Classes
<div className="my-component">
  Static styling
</div>

// CSS Modules
import styles from "./Component.module.css";
<div className={styles.container}>CSS Modules</div>
```

## 🏗️ Architecture

ShadowJS is built with performance and developer experience in mind:

### Fine-grained Reactivity System

- **Automatic dependency tracking**: No manual dependency arrays
- **Efficient updates**: Only affected components re-render
- **Memory management**: Automatic cleanup of unused subscriptions

### Optimized Runtime

- **Minimal bundle size**: Core runtime is < 9KB gzipped
- **Fast reconciliation**: Optimized DOM diffing algorithm
- **Memory efficient**: Smart memory management and cleanup

### Developer Experience

- **TypeScript first**: Full type safety and IntelliSense
- **Great error messages**: Clear error reporting and debugging
- **Hot reload friendly**: Optimized for development workflows

## 📚 Examples

Check out the [examples documentation](../../documentation/examples.md) for comprehensive code examples covering:

- Basic patterns and best practices
- Advanced reactive patterns
- Real-world application examples
- Integration patterns

## 🤝 Contributing

We welcome contributions! See the [Contributing Guide](../../CONTRIBUTING.md) for details.

## 📄 License

MIT License - see [LICENSE](../../LICENSE) for details.

## 📞 Support

- **Documentation**: [ShadowJS Docs](../../README.md)
- **Examples**: [Code Examples](../../documentation/examples.md)
- **Issues**: [GitHub Issues](https://github.com/shadowjs-dev/shadow/issues)
- **Discussions**: [GitHub Discussions](https://github.com/shadowjs-dev/shadow/discussions)

---

Built by Jehaad AL-Johani for fine-grained reactivity.
