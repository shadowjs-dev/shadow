export function isComponentThunk(
  v: unknown
): v is (() => Node) & { __isComponent: true } {
  return (
    typeof v === "function" &&
    (v as { __isComponent?: boolean }).__isComponent === true
  );
}
