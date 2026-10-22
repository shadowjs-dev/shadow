import type { AstNode } from "./ast";

/** An expression of the user's program, already rewritten (nested JSX compiled). */
export interface ExprIR {
  text: string;
  node: AstNode;
  dynamic: boolean;
}

export type Namespace = "html" | "svg" | "math";

export type AttrIR =
  | {
      kind: "static";
      name: string;
      value: string | true;
      /** JavaScript source of the value when it is not a string (numbers), used for component props. */
      js?: string;
      start: number;
    }
  | { kind: "expr"; name: string; expr: ExprIR; start: number }
  | { kind: "spread"; expr: ExprIR; start: number };

export interface ElementIR {
  kind: "element";
  tag: string;
  ns: Namespace;
  custom: boolean;
  attrs: AttrIR[];
  children: ChildIR[];
  start: number;
}

export interface ComponentIR {
  kind: "component";
  callee: string;
  attrs: AttrIR[];
  children: ChildIR[];
  start: number;
}

export interface TextIR {
  kind: "text";
  value: string;
}

export interface SlotIR {
  kind: "slot";
  expr: ExprIR;
}

export interface FragmentIR {
  kind: "fragment";
  children: ChildIR[];
}

export type ChildIR = ElementIR | ComponentIR | TextIR | SlotIR | FragmentIR;
export type RootIR = ElementIR | ComponentIR | FragmentIR;
