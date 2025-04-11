import { describe, expect, it } from "vitest";
import { type IntrospectionResult, parseIntrospectionResult } from "./introspection-result";

describe("parseIntrospectionResult", () => {
  const validData: IntrospectionResult = {
    tables: [
      {
        type: "table",
        name: "users",
        sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
        views: [],
        num_cols: 2,
      },
    ],
    columns: [
      {
        type: "column",
        name: "id",
        table: "users",
        data_type: "INTEGER",
        ordinal_position: 1,
        nullable: false,
        character_maximum_length: null,
        precision: null,
        default: "",
      },
      {
        type: "column",
        name: "name",
        table: "users",
        data_type: "TEXT",
        ordinal_position: 2,
        nullable: false,
        character_maximum_length: null,
        precision: null,
        default: "",
      },
    ],
    indices: [
      {
        type: "index",
        name: "idx_users_name",
        table: "users",
        column: "name",
        unique: true,
        sql: "CREATE UNIQUE INDEX idx_users_name ON users(name)",
      },
    ],
    foreign_keys: [
      {
        type: "foreign_key",
        name: "fk_posts_user_id",
        table: "posts",
        column: "user_id",
        referenced_table: "users",
        referenced_column: "id",
        on_update: "CASCADE",
        on_delete: "CASCADE",
        definition:
          "FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE",
      },
    ],
    primary_keys: [
      {
        type: "primary_key",
        table: "users",
        column: "id",
        field_count: 1,
        definition: "PRIMARY KEY (id)",
      },
    ],
    triggers: [
      {
        type: "trigger",
        name: "after_insert_user",
        table: "users",
        sql: "CREATE TRIGGER after_insert_user AFTER INSERT ON users BEGIN INSERT INTO logs VALUES(NEW.id, 'insert', datetime('now')); END;",
      },
    ],
    views: [
      {
        type: "view",
        name: "user_names",
        sql: "CREATE VIEW user_names AS SELECT name FROM users",
        tables: [],
      },
    ],
  };

  it("should parse valid JSON string input", () => {
    const validJsonString = JSON.stringify(validData);
    const result = parseIntrospectionResult(validJsonString);

    expect(result).toEqual(validData);
  });

  it("should parse valid object input", () => {
    const result = parseIntrospectionResult(validData);

    expect(result).toEqual(validData);
  });

  it("should throw when parsing invalid JSON string", () => {
    const invalidJson = '{"tables": [{"type": "table", "name": "users"}';

    expect(() => parseIntrospectionResult(invalidJson)).toThrow();
  });

  it("should throw when parsing object with missing required fields", () => {
    const missingFieldsData = {
      tables: [
        {
          type: "table",
          // Missing 'name' field
          sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
          views: [],
          num_cols: 2,
        },
      ],
      columns: [],
      indices: [],
      foreign_keys: [],
      primary_keys: [],
      triggers: [],
    };

    expect(() => parseIntrospectionResult(missingFieldsData)).toThrow();
  });

  it("should throw when parsing object with incorrect field types", () => {
    const incorrectTypesData = {
      tables: [
        {
          type: "table",
          name: 42, // Should be a string
          sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
          views: [],
          num_cols: 2,
        },
      ],
      columns: [],
      indices: [],
      foreign_keys: [],
      primary_keys: [],
      triggers: [],
    };

    expect(() => parseIntrospectionResult(incorrectTypesData)).toThrow();
  });

  it("should throw when a field has the wrong discriminator value", () => {
    const wrongDiscriminatorData = {
      tables: [
        {
          type: "invalid_type", // Should be "table"
          name: "users",
          sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
          num_cols: 2,
        },
      ],
      columns: [],
      indices: [],
      foreign_keys: [],
      primary_keys: [],
      triggers: [],
    };

    expect(() => parseIntrospectionResult(wrongDiscriminatorData)).toThrow();
  });

  it("should correctly handle precision objects", () => {
    const dataWithPrecision = {
      ...validData,
      columns: [
        ...validData.columns,
        {
          type: "column",
          name: "amount",
          table: "orders",
          data_type: "DECIMAL",
          ordinal_position: 3,
          nullable: false,
          character_maximum_length: null,
          precision: {
            precision: 10,
            scale: 2,
          },
          default: "",
        },
      ],
    };

    const result = parseIntrospectionResult(dataWithPrecision);

    expect(result.columns[2].precision).toEqual({
      precision: 10,
      scale: 2,
    });
  });

  it("should validate all array items in complex objects", () => {
    // Create a deep copy of validData with one invalid column
    const partiallyInvalidData = JSON.parse(JSON.stringify(validData));

    // Modify one array item to be invalid
    if (partiallyInvalidData.columns.length > 0) {
      partiallyInvalidData.columns[0].nullable = "not-a-boolean"; // Should be a boolean
    }

    expect(() => parseIntrospectionResult(partiallyInvalidData)).toThrow();
  });
});
