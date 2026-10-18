/**
 * What a settings save says when the DATABASE refused it on a constraint
 * (#1506): a foreign key (`23503`) or a unique key (`23505`).
 *
 * These are data-integrity faults, not transient ones. The same save hits the
 * same row again however often it is retried, so "Reload and try again", the
 * generic arm these used to reach, named an action that cannot clear them. The
 * one place that can act is whoever reads feedback, so the message sends the
 * reader there. "Please report it" already says this is not one to retry, so
 * the message does not also say so (copy trimmed in review, #1658).
 *
 * Keyed on the SQLSTATE (`error.code`), never on the message text, which names
 * constraints and changes whenever a schema does.
 */
export function saveConstraintMessage(code: string | null | undefined): string | null {
  switch (code) {
    case "23503": // foreign_key_violation
      return "Couldn’t save — something in this game no longer exists. Please report it with Send feedback.";
    case "23505": // unique_violation
      return "Couldn’t save — something is listed twice. Please report it with Send feedback.";
    default:
      return null;
  }
}
