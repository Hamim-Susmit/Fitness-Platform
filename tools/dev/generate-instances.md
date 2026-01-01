# Generate Class Instances (Dev Utility)

Use the `generate_class_instances` Edge Function to expand schedules into dated class instances.

## When to Run
- After creating or updating class schedules
- When seeding development data
- When rebuilding instances for a new time window

## Generate the Next 30 Days
```bash
curl -X POST \
  "https://<project-ref>.functions.supabase.co/generate_class_instances" \
  -H "Authorization: Bearer <STAFF_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "gym_id": "<gym-id>",
    "from": "2025-01-01",
    "to": "2025-01-30",
    "regenerate": false
  }'
```

## Regenerate After Schedule Changes
```bash
curl -X POST \
  "https://<project-ref>.functions.supabase.co/generate_class_instances" \
  -H "Authorization: Bearer <STAFF_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "gym_id": "<gym-id>",
    "from": "2025-02-01",
    "to": "2025-02-28",
    "regenerate": true
  }'
```

## Notes
- `regenerate: true` deletes existing instances in the range before re-creating.
- Maximum range per request is 90 days.
