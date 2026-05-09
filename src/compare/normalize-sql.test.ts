import { describe, expect, it } from "vitest";
import { normalizeSql } from "./normalize-sql";

describe("normalizeSql", () => {
  it("returns null for null input", () => {
    expect(normalizeSql(null)).toBeNull();
  });

  it("strips double-quoted identifiers", () => {
    expect(normalizeSql('CREATE INDEX "x" ON "t" ("c")')).toBe("CREATE INDEX x ON t(c)");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizeSql("CREATE  INDEX  x   ON   t(c)")).toBe("CREATE INDEX x ON t(c)");
  });

  it("normalizes commas to ', '", () => {
    expect(normalizeSql("CREATE INDEX x ON t(a,b , c)")).toBe("CREATE INDEX x ON t(a, b, c)");
  });

  it("strips whitespace inside parens", () => {
    expect(normalizeSql("CREATE INDEX x ON t( a )")).toBe("CREATE INDEX x ON t(a)");
  });

  it("strips whitespace before opening paren after an identifier", () => {
    expect(normalizeSql("CREATE INDEX x ON t (a)")).toBe("CREATE INDEX x ON t(a)");
  });

  it("treats space-before-paren and no-space-before-paren as equivalent", () => {
    expect(normalizeSql('CREATE INDEX "i" ON "t" ("c")')).toBe(
      normalizeSql('CREATE INDEX "i" ON "t"("c")'),
    );
  });

  it("strips backtick-quoted identifiers (drizzle-kit/drizzle push style)", () => {
    expect(normalizeSql("CREATE INDEX `x` ON `t` (`c`)")).toBe("CREATE INDEX x ON t(c)");
  });

  it("strips square-bracket-quoted identifiers (SQL Server compat)", () => {
    expect(normalizeSql("CREATE INDEX [x] ON [t] ([c])")).toBe("CREATE INDEX x ON t(c)");
  });

  it("treats different quoting styles as equivalent", () => {
    const dq = normalizeSql('CREATE INDEX "i" ON "t"("c")');
    const bt = normalizeSql("CREATE INDEX `i` ON `t`(`c`)");
    const sb = normalizeSql("CREATE INDEX [i] ON [t]([c])");
    expect(dq).toBe(bt);
    expect(bt).toBe(sb);
  });
});
