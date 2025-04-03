# sqlrite

Declarative schema management for sqlite.

SQLRite compares your current database schema against a desired schema and generates the SQL statements needed to migrate between them. It uses SQLite itself to parse and validate schemas, ensuring compatibility.

## Usage

```typescript
import { migrate, getMigrationPlan } from 'sqlrite';

const schema = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL
);
`;

// Automatically migrate
await migrate(db, schema);

// Or get migration plan without executing
const plan = await getMigrationPlan(db, schema);
console.log(plan);
// {
//   statements: ["CREATE TABLE users (...)", ...],
//   risks: [{ type: 'data_loss', index: 3 }, { type: 'table_recreation', index: 5 }]
// }
