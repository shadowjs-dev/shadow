/**
 * Compile-time checks for `mergeProps` and `splitProps`. Vitest does not run this file;
 * `tsc -p packages/core/tsconfig.json` does, so a wrong public type fails the typecheck. The
 * overloads carry the same public types the casts used to assert.
 */
import { describe, expectTypeOf, it } from "vitest";
import { type MergeProps, mergeProps, type SplitProps, splitProps } from "../src/props";

describe("mergeProps types", () => {
  it("[PRT-01] the merged type folds the sources left to right, the right-most key wins", () => {
    const merged = mergeProps({ size: "md", color: "red" }, { color: 3 });
    expectTypeOf(merged.size).toEqualTypeOf<string>();
    expectTypeOf(merged.color).toEqualTypeOf<number>();
  });

  it("[PRT-02] a source that may be undefined keeps the earlier key type as well", () => {
    const base = { label: "a" };
    const extra: { label?: string } | undefined = undefined as { label?: string } | undefined;
    const merged = mergeProps(base, extra);
    expectTypeOf(merged.label).toEqualTypeOf<string>();
  });

  it("[PRT-03] a function source contributes its return type", () => {
    const merged = mergeProps(() => ({ open: true as const }), { title: "t" });
    expectTypeOf(merged.open).toEqualTypeOf<true>();
    expectTypeOf(merged.title).toEqualTypeOf<string>();
  });

  it("[PRT-04] null, undefined and false sources are skipped in the type", () => {
    const merged = mergeProps(null, { id: 1 }, undefined, false);
    expectTypeOf(merged.id).toEqualTypeOf<number>();
  });

  it("[PRT-05] MergeProps of an empty source list is the empty object type", () => {
    expectTypeOf<MergeProps<[]>>().toEqualTypeOf<object>();
  });
});

describe("splitProps types", () => {
  it("[PRT-06] each key list gives a group of its keys, the rest holds every other key", () => {
    const props = { class: "c", style: "s", id: 1, title: "t" };
    const [own, forwarded] = splitProps(props, ["class", "style"]);
    expectTypeOf(own.class).toEqualTypeOf<string>();
    expectTypeOf(own.style).toEqualTypeOf<string>();
    expectTypeOf(forwarded.id).toEqualTypeOf<number>();
    expectTypeOf(forwarded.title).toEqualTypeOf<string>();
    // @ts-expect-error a key that is in a group is not in the rest
    forwarded.class;
  });

  it("[PRT-07] several key lists give one group each, in order, then the rest", () => {
    const [a, b, rest] = splitProps({ x: 1, y: "y", z: true }, ["x"], ["y"]);
    expectTypeOf(a.x).toEqualTypeOf<number>();
    expectTypeOf(b.y).toEqualTypeOf<string>();
    expectTypeOf(rest.z).toEqualTypeOf<boolean>();
  });

  it("[PRT-08] the result type is the SplitProps tuple", () => {
    type Props = { x: number; y: string };
    expectTypeOf<SplitProps<Props, [["x"]]>>().toEqualTypeOf<[{ x: number }, { y: string }]>();
  });

  it("[PRT-09] a key that is not a key of the props is a type error", () => {
    // @ts-expect-error "missing" is not a key of the props
    splitProps({ x: 1 }, ["missing"]);
  });
});
