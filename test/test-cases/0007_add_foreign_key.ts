import type { TestDriver } from "@/test-driver";

export const description = "add foreign key constraint";

// Initial state with two tables but no foreign key
export const current = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL
  );
`;

// Desired state with foreign key constraint added
export const next = `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  
  CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL
  );
`;

export async function verify(driver: TestDriver) {
  // Due to SQLite limitations, adding a foreign key requires table recreation
  driver.ddl.expectStatementCount(4);
  driver.ddl.expectStatement("CREATE TABLE new_posts");
  driver.ddl.expectStatement("INSERT INTO new_posts SELECT");
  driver.ddl.expectStatement("DROP TABLE posts");
  driver.ddl.expectStatement("ALTER TABLE new_posts RENAME TO posts");

  // Verify both tables exist
  await driver.tableExists("users");
  await driver.tableExists("posts");

  // Verify table columns
  await driver.tableHasColumn("posts", "id", "INTEGER");
  await driver.tableHasColumn("posts", "user_id", "INTEGER");
  await driver.tableHasColumn("posts", "title", "TEXT");

  // Verify foreign key constraint exists
  await driver.foreignKeyExists("posts", "user_id", "users");
}
