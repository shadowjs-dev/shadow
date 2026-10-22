export function Note(props: { kind: string; children?: unknown }) {
  return <aside class={`note note-${props.kind}`}>{props.children}</aside>;
}
