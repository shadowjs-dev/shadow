/**
 * Types for `import Page from "./page.mdx"`. Add `/// <reference types="@shadow-js/vite/mdx-env" />` to a `.d.ts` file of
 * the app. A named export of one file (a `frontmatter` from `remark-mdx-frontmatter`) is typed by merging a declaration:
 * `declare module "*.mdx" { export const frontmatter: { title: string }; }`.
 */
declare module "*.mdx" {
  import type { JSX } from "@shadow-js/web";

  /** The props of an MDX page: `components` replaces Markdown elements and supplies the tags the file uses. */
  export interface MdxProps {
    readonly components?: Readonly<Record<string, unknown>>;
    readonly [prop: string]: unknown;
  }

  const MDXContent: (props: MdxProps) => JSX.Element;
  export default MDXContent;
}

declare module "*.md" {
  import type { JSX } from "@shadow-js/web";

  const MarkdownContent: (props: {
    readonly components?: Readonly<Record<string, unknown>>;
  }) => JSX.Element;
  export default MarkdownContent;
}
