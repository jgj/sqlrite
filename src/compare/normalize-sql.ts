// Normalize the SQL stored in sqlite_schema for comparison.
//
// SQLite preserves the exact SQL string passed to CREATE TABLE/INDEX/VIEW/TRIGGER,
// so cosmetic differences flow through verbatim and would otherwise produce
// false-positive diffs. Different DDL generators canonicalize identifiers and
// whitespace differently — drizzle-kit/drizzle push uses backticks
// (`CREATE INDEX \`x\` ON \`t\` (\`c\`)`) while sqlrite's fromDrizzle emits
// double quotes with no space before the paren (`CREATE INDEX "x" ON "t"("c")`).
// After normalization, the four SQLite-supported identifier-quoting styles
// (double quote, backtick, square bracket, unquoted) and the common whitespace
// variants all canonicalize to the same string.
const IDENT = "[a-zA-Z_][a-zA-Z0-9_]*";
const QUOTED_IDENT = new RegExp(`"(${IDENT})"|\`(${IDENT})\`|\\[(${IDENT})\\]`, "g");

export function normalizeSql(sql: string): string;
export function normalizeSql(sql: string | null): string | null;
export function normalizeSql(sql: string | null): string | null {
  if (sql === null) return null;
  return sql
    .replace(QUOTED_IDENT, (_match, dq, bt, sb) => dq ?? bt ?? sb)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(\w)\s+\(/g, "$1(")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .trim();
}
