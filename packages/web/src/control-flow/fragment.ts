/**
 * Props of {@link Fragment}.
 * @since 1.0.0
 */
export interface FragmentProps {
  /**
   * The children to group.
   * @default undefined (the Fragment renders nothing)
   */
  readonly children?: unknown;
}

/**
 * A no-op wrapper: returns `props.children` untouched, so the children are created by the caller's
 * getter exactly as if no wrapper existed. Use it to group several children under one element.
 *
 * @param props The children to group.
 * @returns `props.children`, unchanged.
 * @example
 * import { Fragment } from "@shadow-js/web";
 *
 * function Header() {
 *   return <h1>Title</h1>;
 * }
 *
 * function Page() {
 *   return (
 *     <Fragment>
 *       <Header />
 *       <p>Body</p>
 *     </Fragment>
 *   );
 * }
 * @since 1.0.0
 */
export function Fragment(props: FragmentProps): unknown {
  return props.children;
}
