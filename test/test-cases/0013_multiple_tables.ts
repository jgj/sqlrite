import type { TestDriver } from "@/test-driver";

export const description = "create multiple related tables";

// Initial database state - empty
export const current = "";

// Desired database state - multiple related tables
export const next = `
  CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    lead_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    FOREIGN KEY (lead_id) REFERENCES employees(id),
    FOREIGN KEY (department_id) REFERENCES departments(id)
  );
`;

export async function verify(driver: TestDriver) {
  // Verify we have the expected number of DDL statements
  driver.ddl.expectStatementCount(3);

  // Verify each table creation statement exists
  driver.ddl.expectStatement("CREATE TABLE departments");
  driver.ddl.expectStatement("CREATE TABLE employees");
  driver.ddl.expectStatement("CREATE TABLE projects");

  // Verify departments table structure
  await driver.tableExists("departments");
  await driver.tableHasColumn("departments", "id", "INTEGER");
  await driver.tableHasColumn("departments", "name", "TEXT");
  await driver.columnHasConstraint("departments", "name", "notnull");

  // Verify employees table structure
  await driver.tableExists("employees");
  await driver.tableHasColumn("employees", "id", "INTEGER");
  await driver.tableHasColumn("employees", "name", "TEXT");
  await driver.tableHasColumn("employees", "department_id", "INTEGER");
  await driver.columnHasConstraint("employees", "name", "notnull");
  await driver.columnHasConstraint("employees", "department_id", "notnull");
  await driver.foreignKeyExists("employees", "department_id", "departments");

  // Verify projects table structure
  await driver.tableExists("projects");
  await driver.tableHasColumn("projects", "id", "INTEGER");
  await driver.tableHasColumn("projects", "name", "TEXT");
  await driver.tableHasColumn("projects", "lead_id", "INTEGER");
  await driver.tableHasColumn("projects", "department_id", "INTEGER");
  await driver.columnHasConstraint("projects", "name", "notnull");
  await driver.columnHasConstraint("projects", "lead_id", "notnull");
  await driver.columnHasConstraint("projects", "department_id", "notnull");
  await driver.foreignKeyExists("projects", "lead_id", "employees");
  await driver.foreignKeyExists("projects", "department_id", "departments");
}
