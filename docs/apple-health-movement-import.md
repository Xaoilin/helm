# Apple Health movement import

KAN-266 implements the KAN-263-frozen iPhone movement route as a local export
bridge. The Health surface explains that hosted web cannot claim HealthKit and
offers an explicit Apple Health XML file selection instead. A watch is neither
required nor accepted as the movement source.

The adapter accepts only `HKQuantityTypeIdentifierStepCount` and
`HKQuantityTypeIdentifierDistanceWalkingRunning` records whose selected source
or device label identifies an iPhone. Other Health categories, including
routes, coordinates, heart data, workouts, and medical records, are ignored
and never enter the parsed result. XML declarations/entities, malformed or
oversized files, missing time zones, future samples, ambiguous sources, and
invalid movement records fail closed before evidence submission.

For each app-time-zone local date with positive movement, the adapter creates
one `vitality_activity` input. Its metadata contains only the source label,
local date range, export timestamp and age, movement type names, and a
SHA-256 source/date digest. The existing owner-scoped Life Hero RPC remains the
write authority; its duplicate receipt is surfaced to the user. Re-importing
the same source/date is therefore safe, while a connection failure after a
prior day was accepted may be retried safely because each day has its own
stable identity.

The raw XML is held only in the bounded file-change handler and is not stored
in React state, shared records, diagnostics, analytics, Broadcast, exports, or
assistant context. The file input is cleared immediately after selection.

Focused proof:

- `npm test -- --run src/test/apple-health-movement.test.ts`
- `npm test -- --run src/test/apple-health-movement-import.test.tsx`
- `npm run typecheck`
- `npm run lint:changed -- src/services/appleHealthMovement.ts src/components/AppleHealthMovementImport.tsx src/surfaces/HealthSurface.tsx src/test/apple-health-movement.test.ts src/test/apple-health-movement-import.test.tsx`
