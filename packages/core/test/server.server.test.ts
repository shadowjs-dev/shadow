import { describe, expect, it } from "vitest";
import {
  createRoot,
  flushSync,
  isServer,
  onMount,
  useEffect,
  useMemo,
  useRenderEffect,
  useResource,
  useSignal,
} from "../src/index";

describe("server build", () => {
  it("[G-24] reports isServer and never runs effects", () => {
    expect(isServer).toBe(true);
    const ran: string[] = [];
    createRoot(() => {
      useEffect(() => void ran.push("effect"));
      useRenderEffect(() => void ran.push("render"));
      onMount(() => void ran.push("mount"));
    });
    flushSync();
    expect(ran).toEqual([]);
  });

  it("[SRV-01] signals and memos still compute", () => {
    const [a, setA] = useSignal(2);
    const doubled = useMemo(() => a() * 2);
    expect(doubled()).toBe(4);
    setA(5);
    expect(doubled()).toBe(10);
  });

  it("[SRV-02] resources fetch once, eagerly, without a render effect", async () => {
    let calls = 0;
    let res!: ReturnType<typeof useResource<number>>;
    createRoot(() => {
      res = useResource(() => {
        calls += 1;
        return Promise.resolve(3);
      });
    });
    expect(calls).toBe(1);
    expect(res.state).toBe("pending");
    await Promise.resolve();
    await Promise.resolve();
    expect(res()).toBe(3);
  });
});
