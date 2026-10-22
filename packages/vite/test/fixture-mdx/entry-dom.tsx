import { useSignal } from "@shadow-js/core";
import { render } from "@shadow-js/web";
import { Heading } from "./components";
import Page from "./page.mdx";

/** Mounts the page and returns the setter of the `name` prop, to prove the expression in the file is live. */
export function mountPage(
  container: HTMLElement,
  overrideHeading: boolean,
): (name: string) => void {
  const [name, setName] = useSignal("Ada");
  render(
    () =>
      overrideHeading ? (
        <Page name={name()} components={{ h1: Heading }} />
      ) : (
        <Page name={name()} />
      ),
    container,
  );
  return setName;
}
