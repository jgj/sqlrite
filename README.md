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
const plan = await getMigration(db, schema);
console.log(plan);
// ["CREATE TABLE users (...)", ...]

### SQLite ALTER TABLE

1. Overview

SQLite supports a limited subset of ALTER TABLE. The ALTER TABLE command in SQLite allows these alterations of an existing table: it can be renamed; a column can be renamed; a column can be added to it; or a column can be dropped from it.

The only schema altering commands directly supported by SQLite are the "rename table", "rename column", "add column", "drop column" commands. However, applications can make other arbitrary changes to the format of a table using a simple sequence of operations. The steps to make arbitrary changes to the schema design of some table X are as follows:

If foreign key constraints are enabled, disable them using PRAGMA foreign_keys=OFF.

Start a transaction.

Remember the format of all indexes, triggers, and views associated with table X. This information will be needed in step 8 below. One way to do this is to run a query like the following: SELECT type, sql FROM sqlite_schema WHERE tbl_name='X'.

Use CREATE TABLE to construct a new table "new_X" that is in the desired revised format of table X. Make sure that the name "new_X" does not collide with any existing table name, of course.

Transfer content from X into new_X using a statement like: INSERT INTO new_X SELECT ... FROM X.

Drop the old table X: DROP TABLE X.

Change the name of new_X to X using: ALTER TABLE new_X RENAME TO X.

Use CREATE INDEX, CREATE TRIGGER, and CREATE VIEW to reconstruct indexes, triggers, and views associated with table X. Perhaps use the old format of the triggers, indexes, and views saved from step 3 above as a guide, making changes as appropriate for the alteration.

If any views refer to table X in a way that is affected by the schema change, then drop those views using DROP VIEW and recreate them with whatever changes are necessary to accommodate the schema change using CREATE VIEW.

If foreign key constraints were originally enabled then run PRAGMA foreign_key_check to verify that the schema change did not break any foreign key constraints.

Commit the transaction started in step 2.

If foreign keys constraints were originally enabled, reenable them now.

Caution: Take care to follow the procedure above precisely. The boxes below summarize two procedures for modifying a table definition. At first glance, they both appear to accomplish the same thing. However, the procedure on the right does not always work, especially with the enhanced rename table capabilities added by versions 3.25.0 and 3.26.0. In the procedure on the right, the initial rename of the table to a temporary name might corrupt references to that table in triggers, views, and foreign key constraints. The safe procedure on the left constructs the revised table definition using a new temporary name, then renames the table into its final name, which does not break links.

Create new table
Copy data
Drop old table
Rename new into old
↑
Correct


Rename old table
Create new table
Copy data
Drop old table
↑
Incorrect
