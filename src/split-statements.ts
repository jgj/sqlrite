export function splitStatements(sql: string): {
  statements: string[];
  comments: Array<{ text: string; statementIndex: number }>;
} {
  const statements: string[] = [];
  const comments: Array<{ text: string; statementIndex: number }> = [];

  let currentStatement = "";
  let currentComment = "";

  // State tracking
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inTriggerBody = false;
  let triggerDepth = 0;

  // Process the SQL character by character
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = i < sql.length - 1 ? sql[i + 1] : "";

    // Handle string literals (single quotes in SQLite)
    if (char === "'" && !inDoubleQuote && !inLineComment && !inBlockComment) {
      // In SQLite, single quotes are escaped by doubling them (''), not with backslash
      // Toggle the state only if the character isn't part of an escaped quote
      if (nextChar === "'") {
        // This is an escaped quote - add both characters and skip the next one
        currentStatement += "''";
        i++;
      } else {
        // Toggle the state
        inSingleQuote = !inSingleQuote;
        currentStatement += char;
      }
    }
    // Handle identifiers (double quotes in SQLite)
    else if (char === '"' && !inSingleQuote && !inLineComment && !inBlockComment) {
      inDoubleQuote = !inDoubleQuote;
      currentStatement += char;
    }

    // Handle comments - track them separately
    else if (
      char === "-" &&
      nextChar === "-" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      !inBlockComment &&
      !inLineComment
    ) {
      inLineComment = true;
      currentComment = "--";
      i++; // Skip the next dash
    } else if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        comments.push({
          text: currentComment,
          statementIndex: 0, // We'll adjust this later
        });
        currentComment = "";
      } else {
        currentComment += char;
      }
    } else if (
      char === "/" &&
      nextChar === "*" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      !inLineComment &&
      !inBlockComment
    ) {
      inBlockComment = true;
      currentComment = "/*";
      i++; // Skip the next character
    } else if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        currentComment += "*/";
        comments.push({
          text: currentComment,
          statementIndex: 0, // We'll adjust this later
        });
        currentComment = "";
        inBlockComment = false;
        i++; // Skip the next character
      } else {
        currentComment += char;
      }
    }

    // Handle statement termination with semicolon
    else if (
      char === ";" &&
      !inSingleQuote &&
      !inDoubleQuote &&
      !inLineComment &&
      !inBlockComment
    ) {
      currentStatement += char;

      // Check for CREATE TRIGGER
      const upperStatement = currentStatement.toUpperCase();

      if (upperStatement.trim().startsWith("CREATE TRIGGER") && !inTriggerBody) {
        // Look for BEGIN keyword to indicate start of trigger body
        if (upperStatement.includes(" BEGIN")) {
          inTriggerBody = true;
          triggerDepth = 1;
        }
      }
      // Handle trigger body termination
      else if (inTriggerBody) {
        // Check if this is the final END; of the trigger
        if (upperStatement.trim().endsWith("END;")) {
          // Count all BEGIN and END keywords to track nesting
          const beginCount = (upperStatement.match(/\bBEGIN\b/g) || []).length;
          const endCount = (upperStatement.match(/\bEND\b/g) || []).length;

          if (endCount >= beginCount) {
            inTriggerBody = false;
            if (currentStatement.trim().length > 0) {
              statements.push(currentStatement.trim());
              currentStatement = "";
            }
          }
        }
      }
      // Regular statement termination
      else if (!inTriggerBody) {
        if (currentStatement.trim().length > 0) {
          statements.push(currentStatement.trim());
          currentStatement = "";
        }
      }
    }
    // Add character to current statement for all other cases
    else if (!inLineComment && !inBlockComment) {
      currentStatement += char;
    }
  }

  // Add the last statement if there's anything left
  if (currentStatement.trim().length > 0) {
    statements.push(currentStatement.trim());
  }

  // If there's an unfinished comment, add it
  if (currentComment.length > 0) {
    comments.push({
      text: currentComment,
      statementIndex: 0,
    });
  }

  // Filter out empty statements and trim whitespace
  const filteredStatements = statements.filter((stmt) => {
    // Keep only non-empty statements that aren't just semicolons
    const trimmed = stmt.trim();
    return trimmed.length > 0 && trimmed !== ";";
  });

  return {
    statements: filteredStatements,
    comments: comments,
  };
}
