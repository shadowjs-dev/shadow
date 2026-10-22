export function Heading(props: { children?: unknown }) {
  return <h1 class="big">{props.children}</h1>;
}

export function Layout(props: { children?: unknown }) {
  return <main>{props.children}</main>;
}
