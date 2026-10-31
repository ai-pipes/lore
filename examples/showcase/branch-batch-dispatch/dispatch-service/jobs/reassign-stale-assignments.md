---
slug: jobs/reassign-stale-assignments
domain: dispatch
entry_type: job
handler_class: ReassignStaleAssignmentsJob
summary: Every 60 s finds accepted assignments whose courier made no progress toward pickup for 10 minutes and reassigns them
category: implementation
links:
  - slug: dispatch/reassign-courier
    type: calls
  - slug: dispatch/assign-courier
    type: related_to
  - slug: schemas/assignments
    type: references
  - slug: ops/no-couriers-available
    type: related_to
  - slug: tracking/ingest-courier-location
    library: tracking-service
    type: depends_on
  - slug: tracking/on-courier-assigned
    library: tracking-service
    type: calls
  - slug: ops/stuck-orders
    library: orders-service
    type: related_to
---

# ReassignStaleAssignmentsJob

Scheduled job that protects customers from couriers who accepted an order and then never showed up.

## Trigger

- Every 60 s (cron `* * * * *`), one instance at a time via the Postgres advisory lock `dispatch.stale_job`.
- Data source: table: assignments plus tracking-service `GET /internal/sessions/{order_id}/progress` (distance to pickup, last movement) for each accepted assignment.

## Business Logic

1. Select assignments with `status = accepted` and `last_progress_at < now() - interval '10 minutes'`, oldest first, at most 200 per run.
2. Refresh `last_progress_at` from `GET /internal/sessions/{order_id}/progress`: it advances whenever the courier's road distance to the pickup dropped by at least 100 m (positions from `tracking/ingest-courier-location`). An offline courier makes no progress. If tracking does not answer within 2 s, skip the assignment this run — never reassign on missing data.
3. For each stale assignment, skip it if the courier is within 150 m of the pickup (waiting at the door counts as progress).
4. Run the reassignment logic of `dispatch/reassign-courier` with `reason = stale`, actor `system`.
5. An order may be reassigned automatically at most **2 times**. On the third staleness, do not reassign; raise `DispatchStaleRepeated` and leave it to ops (`ops/no-couriers-available`).
6. Notify the replaced courier: "Order removed — no movement toward pickup for 10 minutes." Repeated staleness (3 in 7 days) flags the courier for review.

## External Dependencies

- table: assignments
- service: tracking-service — `GET /internal/sessions/{order_id}/progress`
- service: courier-app-push
- topic: `parcelly.dispatch-events` — via the reassignment's `courier.assigned`

## Error Handling

The job is idempotent: a failure on one assignment is logged and retried on the next run. If the job has not finished
a run for 5 minutes, `DispatchStaleJobStuck` alerts dispatch on-call.

Metrics: `dispatch_stale_reassignments_total`, `dispatch_stale_job_duration_seconds`.
