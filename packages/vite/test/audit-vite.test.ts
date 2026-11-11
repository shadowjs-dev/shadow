import { describe, expect, it } from "vitest";
import { shadowMdx } from "../src/mdx";

/** What a plugin context received from `error`, with the position it was given. */
interface Report {
  message: string;
  position: { line: number; column: number } | undefined;
}

type Transform = (
  this: {
    error(message: string, position?: Report["position"]): never;
    warn(message: string, position?: Report["position"]): void;
  },
  code: string,
  id: string,
  options?: { ssr?: boolean },
) => Promise<unknown>;

function transformOf(plugin: ReturnType<typeof shadowMdx>): Transform {
  const hook = plugin.transform;
  return (typeof hook === "function" ? hook : hook?.handler) as unknown as Transform;
}

/** Runs the plugin on one MDX file and returns what it reported as errors and warnings. */
async function reports(mdx: string): Promise<{ errors: Report[]; warnings: Report[] }> {
  const errors: Report[] = [];
  const warnings: Report[] = [];
  const context = {
    error(message: string, position?: Report["position"]): never {
      errors.push({ message, position });
      throw new Error("reported");
    },
    warn(message: string, position?: Report["position"]): void {
      warnings.push({ message, position });
    },
  };
  await transformOf(shadowMdx())
    .call(context, mdx, "/a/page.mdx")
    .catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== "reported") throw error;
    });
  return { errors, warnings };
}

describe("[VIT-AUD-01] positions of the MDX plugin refer to the MDX file", () => {
  it("an error of the JSX pass carries no line and column: they would point into the generated code", async () => {
    // Line 7 of the MDX holds the nesting the HTML parser would repair; the generated JSX puts it on line 10.
    const { errors } = await reports("# Title\n\nSome text\n\nMore text\n\n<p><div>x</div></p>\n");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("INVALID_HTML_NESTING");
    expect(errors[0]?.position).toBeUndefined();
  });

  it("an error of the MDX parser still carries its own line and column", async () => {
    const { errors } = await reports("# ok\n\n{1 +}\n");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.position).toEqual({ line: 3, column: 4 });
  });

  it("a page without problems reports nothing", async () => {
    const { errors, warnings } = await reports("# Fine\n\ntext\n");
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
