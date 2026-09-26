# Service contracts

Each JSON file is one response the app relies on from a Spring Boot service in
[`Xaoilin/sabah-one-services`](https://github.com/Xaoilin/sabah-one-services): the request,
the status, and an example body.

| Checked by | How |
| --- | --- |
| This app, unit tests | `src/test/service-contracts.test.ts` parses every example through the runtime schemas in `src/services/backend/contracts.ts`, which also parse every live response. |
| This app, browser tests | `e2e/support/fake-services.ts` validates every fake response against the same schemas. |
| The services | `PrayerContractTest` and `ProfileContractTest` fail when a real response loses a field or changes a JSON type from its example; CI fails when these files differ from this repository's `master`. |

To change a contract, update the files here and in the services repository in the same change
(the services' `-Dcontracts.record=true` rewrites them from real responses), then merge the
consumer side first.
