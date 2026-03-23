export const description = "create multiple related tables";

export const current = "";

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
