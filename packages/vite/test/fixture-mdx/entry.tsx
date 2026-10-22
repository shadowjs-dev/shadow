import { renderToString } from "@shadow-js/web/server";
import { Heading, Layout } from "./components";
import Page, { frontmatter, meta } from "./page.mdx";

export { frontmatter, meta, renderToString };
export const plain = () => <Page name="Ada" />;
export const overridden = () => <Page name="Ada" components={{ h1: Heading }} />;
export const wrapped = () => <Page name="Ada" components={{ wrapper: Layout }} />;
