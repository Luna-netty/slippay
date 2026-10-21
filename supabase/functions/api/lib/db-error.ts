// Audit-004 · C3 — translate Postgres / PostgREST errors into opaque enums
// before they're sent to API callers. Echoing `error.message` leaks constraint
// names, regex patterns, and (with bad luck) row contents. Centralizing here
// keeps the routes shallow and consistent.

export interface ApiError {
  code: string;
  status: number;
}

interface PgError {
  code?: string;
  message?: string;
}

const PG_CODE_MAP: Record<string, ApiError> = {
  "23505": { code: "constraint_violation", status: 409 }, // unique_violation
  "23503": { code: "reference_invalid",    status: 400 }, // foreign_key_violation
  "23502": { code: "value_required",       status: 400 }, // not_null_violation
  "23514": { code: "value_invalid",        status: 400 }, // check_violation
  "22001": { code: "value_too_long",       status: 400 }, // string_data_right_truncation
  "22003": { code: "value_out_of_range",   status: 400 }, // numeric_value_out_of_range
  "22P02": { code: "value_invalid",        status: 400 }, // invalid_text_representation
  "42501": { code: "forbidden",            status: 403 }, // insufficient_privilege
  "40001": { code: "conflict_retry",       status: 409 }, // serialization_failure
  "PGRST116": { code: "not_found",         status: 404 }, // No rows in single()
};

export function mapDbError(err: PgError | null | undefined): ApiError {
  if (!err) return { code: "internal_error", status: 500 };
  if (err.code && PG_CODE_MAP[err.code]) return PG_CODE_MAP[err.code]!;
  // PostgREST sometimes nests Postgres codes inside message; sniff the common
  // pattern but never echo the message itself.
  if (err.message?.includes("duplicate key") || err.message?.includes("unique constraint")) {
    return PG_CODE_MAP["23505"]!;
  }
  if (err.message?.includes("violates check constraint")) {
    return PG_CODE_MAP["23514"]!;
  }
  if (err.message?.includes("violates foreign key")) {
    return PG_CODE_MAP["23503"]!;
  }
  return { code: "operation_failed", status: 400 };
}
