import { describe, expect, it } from "vitest";
import { splitStatements } from "./split-statements";

describe("splitStatements", () => {
  it("should split simple statements", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER);
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);");
    expect(statements[1]).toBe("CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER);");
  });

  it("should handle string literals with semicolons", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      INSERT INTO messages (text) VALUES ('Hello; world');
      CREATE TABLE logs (id INTEGER PRIMARY KEY);
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(3);
    expect(statements[1]).toBe("INSERT INTO messages (text) VALUES ('Hello; world');");
  });

  it("should handle identifiers with double quotes", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY, "user name" TEXT);
      INSERT INTO users ("user name") VALUES ('John Doe');
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('"user name"');
    expect(statements[1]).toContain('"user name"');
  });

  it("should extract inline comments and associate with statements", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY); -- This is a comment; with semicolons;
      CREATE TABLE posts (id INTEGER PRIMARY KEY);
    `;

    const { statements, comments } = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("CREATE TABLE users (id INTEGER PRIMARY KEY);");
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe("-- This is a comment; with semicolons;");
    expect(comments[0].statementIndex).toBe(0);
  });

  it("should extract block comments and associate with statements", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      /* This is a block comment;
         with multiple lines;
         and semicolons; */
      CREATE TABLE posts (id INTEGER PRIMARY KEY);
    `;

    const { statements, comments } = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("CREATE TABLE users (id INTEGER PRIMARY KEY);");
    expect(statements[1]).toBe("CREATE TABLE posts (id INTEGER PRIMARY KEY);");
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toContain("This is a block comment");
    expect(comments[0].statementIndex).toBe(0); // Associate with first statement
  });

  it("should handle empty statements", () => {
    const sql = `
      ;;;
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      ;
      CREATE TABLE posts (id INTEGER PRIMARY KEY);
      ;
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("CREATE TABLE users (id INTEGER PRIMARY KEY);");
    expect(statements[1]).toBe("CREATE TABLE posts (id INTEGER PRIMARY KEY);");
  });

  it("should handle statements without semicolons at the end", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE posts (id INTEGER PRIMARY KEY)
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("CREATE TABLE users (id INTEGER PRIMARY KEY);");
    expect(statements[1]).toBe("CREATE TABLE posts (id INTEGER PRIMARY KEY)");
  });

  it("should handle CREATE TRIGGER statements with internal semicolons", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
      
      CREATE TRIGGER after_insert_user AFTER INSERT ON users 
      BEGIN
        INSERT INTO logs (event) VALUES ('user created');
        UPDATE stats SET user_count = user_count + 1;
      END;
      
      CREATE TABLE logs (id INTEGER PRIMARY KEY, event TEXT);
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("CREATE TABLE users");
    expect(statements[1]).toContain("CREATE TRIGGER after_insert_user");
    expect(statements[1]).toContain("END;");
    expect(statements[2]).toContain("CREATE TABLE logs");
  });

  it("should handle nested BEGIN/END blocks in triggers", () => {
    const sql = `
      CREATE TRIGGER complex_trigger AFTER INSERT ON users BEGIN
        INSERT INTO logs (event) VALUES ('user created');
        
        BEGIN
          UPDATE stats SET user_count = user_count + 1;
          
          BEGIN
            INSERT INTO notifications (text) VALUES ('New user joined');
          END;
          
        END;
      END;
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("CREATE TRIGGER complex_trigger");
    expect(statements[0]).toContain("BEGIN\n        INSERT INTO logs");
    expect(statements[0]).toContain("BEGIN\n          UPDATE stats");
    expect(statements[0]).toContain("BEGIN\n            INSERT INTO notifications");
  });

  it("should handle escaped quotes in string literals", () => {
    const sql = `
      INSERT INTO users (name) VALUES ('O''Reilly');
      INSERT INTO quotes (text) VALUES ('Single quote: '''', Double quote: "');
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe("INSERT INTO users (name) VALUES ('O''Reilly');");
    expect(statements[1]).toBe(
      "INSERT INTO quotes (text) VALUES ('Single quote: '''', Double quote: \"');",
    );
  });

  it("should handle complex real-world schema", () => {
    const sql = `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX idx_users_email ON users(email);
      
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        published_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      
      CREATE TRIGGER after_insert_post AFTER INSERT ON posts
      BEGIN
        UPDATE users SET post_count = post_count + 1 WHERE id = NEW.user_id;
        INSERT INTO notifications (user_id, message) 
        VALUES (NEW.user_id, 'Your post was created successfully!');
      END;
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(4);
    expect(statements[0]).toContain("CREATE TABLE users");
    expect(statements[1]).toContain("CREATE INDEX idx_users_email");
    expect(statements[2]).toContain("CREATE TABLE posts");
    expect(statements[3]).toContain("CREATE TRIGGER after_insert_post");
  });

  it("should correctly identify trigger bodies with BEGIN on the same line", () => {
    const sql = `
      CREATE TRIGGER update_timestamp BEFORE UPDATE ON users BEGIN
        UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
      END;
    `;

    const { statements } = splitStatements(sql);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("CREATE TRIGGER update_timestamp");
    expect(statements[0]).toContain("END;");
  });

  it("should handle comments at the beginning of SQL input", () => {
    const sql = `
      -- Initial setup
      /* Database schema
         Created: 2024-04-03 */
      CREATE TABLE users (id INTEGER PRIMARY KEY);
    `;

    const { statements, comments } = splitStatements(sql);

    expect(statements).toHaveLength(1);
    expect(comments).toHaveLength(2);
    expect(comments[0].text).toContain("Initial setup");
    expect(comments[1].text).toContain("Database schema");
    expect(comments[0].statementIndex).toBe(0);
    expect(comments[1].statementIndex).toBe(0);
  });

  it("should handle comments at the end of SQL input", () => {
    const sql = `
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      -- Final table
      /* End of schema */
    `;

    const { statements, comments } = splitStatements(sql);

    expect(statements).toHaveLength(1);
    expect(comments).toHaveLength(2);
    expect(comments[0].text).toContain("Final table");
    expect(comments[1].text).toContain("End of schema");
    expect(comments[0].statementIndex).toBe(0);
    expect(comments[1].statementIndex).toBe(0);
  });
});
