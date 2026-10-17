/**
 * What a settings save says when the DATABASE refused it on a constraint
 * (#1506): a foreign key (`23503`) or a unique key (`23505`).
 *
 * These are data-integrity faults, not transient ones. The same save hits the
 * same row again however often it is retried, so "Reload and try again", the
 * generic arm these used to reach, named an action that cannot clear them. The
 * one place that can act is whoever reads feedback, so the message sends the
 * reader there.
 *
 * Keyed on the SQLSTATE (`error.code`), never on the message text, which names
 * constraints and changes whenever a schema does.
 */
export function saveConstraintMessage(code: string | null | undefined): string | null {
  switch (code) {
    case "23503": // foreign_key_violation
      return "This game includes someone or something that no longer exists, so it can't be saved. Reloading won't fix it. Please report it with Send feedback.";
    case "23505": // unique_violation
      return "This game lists something twice, so it can't be saved. Reloading won't fix it. Please report it with Send feedback.";
    default:
      return null;
  }
}
