# Service contracts

Each JSON file is one response the app relies on from a Spring Boot service in
[`Xaoilin/sabah-one-services`](https://github.com/Xaoilin/sabah-one-services): the request,
the status, and an example body.

| Checked by | How |
| --- | --- |
| This app, unit tests | `src/test/service-contracts.test.ts` parses every example through the runtime schemas in `src/services/backend/contracts.ts`, which also parse every live response. |
| This app, browser tests | `e2e/support/fake-services.ts` validates every fake response against the same schemas. |
| The services | `PrayerContractTest`, `ProfileContractTest` and `CalendarContractTest` fail when a real response loses a field or changes a JSON type from its example; CI fails when these files differ from this repository's `master`. |

To change a contract, update the files here and in the services repository in the same change
(the services' `-Dcontracts.record=true` rewrites them from real responses), then merge the
consumer side first.

## Writes

Every write (`POST`, `PUT`, `PATCH`, `DELETE`) sends an `Idempotency-Key` header naming the user
action (`src/services/backend/idempotencyKeys.ts`); retries of that action reuse it. The services
route writes through RabbitMQ and apply a key once: a repeat returns the stored response with
`Idempotent-Replayed: true`, and the same key with a different request is refused with
`422 idempotency_key_reused`. The browser-test fake enforces the same rules.
