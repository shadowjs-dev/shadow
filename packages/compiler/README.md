# ShadowJS Compiler

[![npm version](https://img.shields.io/npm/v/@shadow-js/compiler.svg)](https://www.npmjs.com/package/@shadow-js/compiler)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The ShadowJS JSX compiler that transforms JSX code into Shadow-compatible reactive expressions. This compiler enables Shadow's fine-grained reactivity by automatically wrapping JSX expressions in reactive functions.

## ✨ Features

- **🎯 JSX Transformation**: Converts JSX to reactive expressions automatically
- **⚡ Compile-time Optimization**: Optimizes JSX at build time
- **🎨 React-like Syntax**: Familiar JSX syntax with reactive enhancements
- **🔧 TypeScript Support**: Full TypeScript and TSX compilation
- **📦 Zero Runtime**: All transformations happen at compile time
- **🎭 Control Flow Enhancement**: Special handling for Show, Match, For components
- **🎯 Ref Handling**: Automatic ref assignment functions
- **🎨 Style Reactivity**: Makes style objects reactive

## 📦 Installation

```bash
npm install @shadow-js/compiler
```

Usually used together with the Vite plugin:

```bash
npm install @shadow-js/compiler @shadow-js/vite
```

## 🚀 Quick Start

The compiler is typically used through the Vite plugin, but can also be used directly:

```tsx
import { transformSource } from "@shadow-js/compiler";

const jsxCode = `
  const App = () => (
    <div>
      <Show when={count() > 0} fallback={<div>No items</div>}>
        <div>Count: {count()}</div>
      </Show>
    </div>
  );
`;

const transformedCode = transformSource(jsxCode);
console.log(transformedCode);
```

## 🎯 How It Works

The compiler transforms JSX in two main phases:

### Phase 1: Arrow Function Transformations

Transforms JSX in arrow function bodies:

```tsx
// Input
const App = () => <div>{count()}</div>;

// Output
const App = () => <div>{() => count()}</div>;
```

### Phase 2: Return Statement Transformations

Transforms JSX in return statements:

```tsx
// Input
function App() {
  return <div>{items.length}</div>;
}

// Output
function App() {
  return <div>{() => items.length}</div>;
}
```

## 🔧 API Reference

### Main Functions

| Function                             | Description                                                |
| ------------------------------------ | ---------------------------------------------------------- |
| `transformSource(code)`              | Transform JSX source code to Shadow-compatible expressions |
| `transformArrowImplicitBodies(code)` | Transform JSX in arrow function implicit bodies            |
| `transformAllReturnParens(code)`     | Transform JSX in return statement parentheses              |

### Utility Functions

| Function                                 | Description                            |
| ---------------------------------------- | -------------------------------------- |
| `applyJsxTransforms(jsxContent)`         | Apply JSX-specific transformations     |
| `findMatching(code, start, open, close)` | Find matching brackets in code         |
| `hasJsxTag(code)`                        | Check if code contains JSX tags        |
| `isFunction(code)`                       | Check if code is a function expression |

## 🎯 Transformation Examples

### Basic Expression Wrapping

```tsx
// Input
<div>Hello {name}</div>

// Output
<div>Hello {() => name}</div>
```

### Control Flow Enhancement

```tsx
// Input
<Show when={count > 0}>
  <div>Count: {count}</div>
</Show>

// Output
<Show when={() => count > 0}>
  <div>Count: {() => count}</div>
</Show>
```

### Ref Handling

```tsx
// Input
<div ref={myRef} />

// Output
<div ref={(el) => myRef = el} />
```

### Style Object Reactivity

```tsx
// Input
<div style={{ color: "red" }} />

// Output
<div style={() => ({ color: "red" })} />
```

### For Loop Enhancement

```tsx
// Input
<For each={items}>
  {(item) => <li>{item.name}</li>}
</For>

// Output
<For each={() => items}>
  {(item) => <li>{() => item.name}</li>}
</For>
```

## 🏗️ Architecture

The compiler consists of several transformation modules:

### 1. Source Transformation (`transformSource.ts`)

Main entry point that orchestrates all transformations:

- Coordinates arrow function and return statement processing
- Handles error reporting and recovery
- Provides the public API

### 2. Arrow Function Processing (`transformArrowImplicitBodies.ts`)

Handles JSX in arrow function bodies:

- Uses simple lexer to skip strings and comments
- Finds arrow functions with implicit JSX bodies
- Applies JSX transformations to function bodies

### 3. Return Statement Processing (`transformAllReturnParens.ts`)

Handles JSX in return statements:

- Finds `return (` statements
- Applies transformations to JSX content
- Handles nested function contexts

### 4. JSX Transformations (`applyJsxTransforms.ts`)

Core JSX transformation logic:

- **Expression wrapping**: Makes child expressions reactive
- **Attribute processing**: Handles special attributes (ref, style, when, etc.)
- **Recursive processing**: Handles nested JSX and function expressions
- **String/comment handling**: Preserves code structure

### 5. Utility Functions

Supporting utilities for code analysis:

- **Bracket matching**: Find matching parentheses, braces, brackets
- **JSX detection**: Identify JSX tags in code
- **Function detection**: Identify function expressions
- **Reference checking**: Identify bare references vs. expressions

## 🔧 Advanced Usage

### Custom Transformations

You can extend the compiler by creating custom transformations:

```typescript
import { applyJsxTransforms } from "@shadow-js/compiler";

function customTransform(jsxContent: string): string {
  // Apply built-in transformations first
  let result = applyJsxTransforms(jsxContent);

  // Add custom transformations
  result = result.replace(/@custom/g, "customTransform");

  return result;
}
```

### Integration with Build Tools

#### Vite Plugin Integration

The recommended way to use the compiler:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import shadow from "@shadow-js/vite";

export default defineConfig({
  plugins: [shadow()],
});
```

#### Manual Integration

For custom build setups:

```typescript
import { transformSource } from "@shadow-js/compiler";

export function shadowPlugin() {
  return {
    name: "shadow-compiler",
    transform(code, id) {
      if (id.endsWith(".tsx") || id.endsWith(".jsx")) {
        return transformSource(code);
      }
    },
  };
}
```

### Error Handling

The compiler provides detailed error messages:

```typescript
try {
  const transformed = transformSource(sourceCode);
  // Use transformed code
} catch (error) {
  console.error("ShadowJS compilation failed:", error.message);
  // Handle compilation error
}
```

## 🎯 Best Practices

### Code Organization

- Keep JSX expressions simple and readable
- Use meaningful variable names in reactive expressions
- Avoid complex logic in JSX expressions

### Performance Considerations

- The compiler runs at build time, no runtime overhead
- Transformations are optimized for minimal code generation
- Use build-time analysis for optimal results

### Debugging

- Check transformed output when debugging reactivity issues
- Use source maps for accurate error locations
- Test transformations with simple examples first

## 🔍 Compiler Options

While the compiler currently has minimal configuration, future versions may include:

- **Transformation modes**: Different levels of reactivity
- **Custom attribute handling**: Support for custom JSX attributes
- **Optimization levels**: Different compilation strategies
- **Source map generation**: Enhanced debugging support

## 🧪 Testing

### Testing Transformations

```typescript
import { transformSource } from "@shadow-js/compiler";

describe("ShadowJS Compiler", () => {
  test("transforms basic JSX expressions", () => {
    const input = "<div>{name}</div>";
    const output = transformSource(input);
    expect(output).toContain("{() => name}");
  });

  test("handles control flow components", () => {
    const input = "<Show when={count > 0}><div>Count</div></Show>";
    const output = transformSource(input);
    expect(output).toContain("when={() => count > 0}");
  });
});
```

## 📊 Performance

### Compilation Speed

- **Fast parsing**: Simple lexer for string/comment skipping
- **Efficient transformations**: Targeted regex replacements
- **Minimal passes**: Usually 1-2 transformation passes

### Bundle Impact

- **Zero runtime**: All transformations happen at build time
- **Small overhead**: Minimal additional code generated
- **Tree-shaking friendly**: Generated code works with tree-shaking

## 🐛 Troubleshooting

### Common Issues

1. **Expression not reactive**: Check if expression is properly wrapped

   ```tsx
   // Wrong
   <div>{count + 1}</div>

   // Right
   <div>{() => count + 1}</div>
   ```

2. **Control flow not working**: Ensure conditions are wrapped in functions

   ```tsx
   // Wrong
   <Show when={count > 0}>

   // Right
   <Show when={() => count > 0}>
   ```

3. **Ref not working**: Check ref assignment function syntax

   ```tsx
   // Wrong
   <div ref={myRef} />

   // Right - compiler transforms this automatically
   <div ref={myRef} />
   // Becomes: <div ref={(el) => myRef = el} />
   ```

### Debug Mode

Enable debug mode for detailed transformation logs:

```typescript
// Enable in development
process.env.SHADOW_DEBUG = "true";

const transformed = transformSource(sourceCode);
console.log("Transformation result:", transformed);
```

## 📚 Examples

See the [examples documentation](../../documentation/examples.md) for:

- Basic transformation patterns
- Advanced usage scenarios
- Integration examples
- Common transformation patterns

## 🤝 Contributing

We welcome contributions! See the [Contributing Guide](../../CONTRIBUTING.md) for details.

Areas for contribution:

- New transformation patterns
- Performance optimizations
- Additional utility functions
- Better error messages
- Enhanced TypeScript support

## 📄 License

MIT License - see [LICENSE](../../LICENSE) for details.

## 📞 Support

- **Documentation**: [Compiler API](../../packages/compiler/src/index.ts)
- **Examples**: [Transformation Examples](../../documentation/examples.md)
- **Issues**: [GitHub Issues](https://github.com/shadowjs-dev/shadow/issues)
- **Discussions**: [GitHub Discussions](https://github.com/shadowjs-dev/shadow/discussions)

---

Built by Jehaad AL-Johani for compile-time JSX transformations.
