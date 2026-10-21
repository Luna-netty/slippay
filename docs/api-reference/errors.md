# Errors

SlipPay returns errors as JSON with consistent shape:

```json
{
  "error": "validation_error",
  "detail": "brl_amount: must be string with 2 decimals",
  "issues": [ ... ]
}
```

| field | type | when present |
|---|---|---|
| `error` | string | always; machine-readable code |
| `detail` | string | optional; human-readable explanation |
| `issues` | array | only on `validation_error`; per-field zod issues |

## Status code conventions

| status | meaning |
|---|---|
| 2xx | success |
| 400 | malformed request, validation failure, business-rule violation |
| 401 | missing or invalid credentials |
| 403 | authenticated but forbidden from the resource |
| 404 | resource not found OR you don't have permission to see it (no leak) |
| 409 | resource state conflicts with the action (e.g., charge after cancel) |
| 422 | semantic error in input that schema didn't catch |
| 5xx | SlipPay broke; safe to retry with backoff |

## Common error codes

### Authentication

| status | code | meaning |
|---|---|---|
| 401 | `missing_authorization` | no `Authorization` header |
| 401 | `invalid_api_key` | API key doesn't match any merchant |
| 401 | `invalid_jwt` | JWT signature failed or expired |
| 403 | `forbidden` | wrong owner |

### Validation

| status | code | meaning |
|---|---|---|
| 400 | `validation_error` | zod failed; see `issues` for details |
| 400 | `empty_update` | PATCH body had no editable fields |

### Orders

| status | code | meaning |
|---|---|---|
| 400 | `create_failed` | DB insert error; `detail` has the message |
| 400 | `cannot_cancel` | order is not in `pending` state |
| 404 | `not_found` | order doesn't exist or doesn't belong to you |

### Subscriptions

| status | code | meaning |
|---|---|---|
| 404 | `not_found` | subscription doesn't exist or wrong owner |
| 409 | `not_active` | status is paused, cancelled, or expired |
| 409 | `expired` | expires_at has passed |
| 409 | `max_periods_reached` | charges_done >= max_periods |
| 400 | `order_create_failed` | charge failed to materialize order; `detail` has message |
| 400 | `cannot_cancel` | already cancelled |

### Merchants

| status | code | meaning |
|---|---|---|
| 400 | `create_failed` | DB insert failed (likely duplicate auth_user_id) |
| 400 | `update_failed` | PATCH failed |
| 400 | `rotate_failed` | key rotation failed |
| 404 | `not_found` | no merchant for this auth user |

## Retry guidance

| status | retry? |
|---|---|
| 4xx | no — the request is wrong; fix and retry manually |
| 5xx | yes — exponential backoff, max 5 attempts |
| network error / timeout | yes — but be careful about idempotency (orders are not idempotent on POST; use the `subscription.charge` idempotency contract for recurring) |

## Validation issue shape

When `error` is `validation_error`, `issues` contains zod's per-field errors:

```json
{
  "error": "validation_error",
  "issues": [
    {
      "path": ["brl_amount"],
      "code": "invalid_string",
      "message": "must be string with 2 decimals"
    },
    {
      "path": ["period_seconds"],
      "code": "too_small",
      "message": "Number must be greater than or equal to 86400"
    }
  ]
}
```

Use `issues[i].path` to map back to your form fields.

## Reporting bugs

If you hit an error code that's not documented here, or a 5xx with no
useful detail, file an issue at
[github.com/Galmanus/slippay/issues](https://github.com/Galmanus/slippay/issues)
with:

- the request you sent (sanitize the API key)
- the response body and status
- timestamp (so we can find the request in server logs)
