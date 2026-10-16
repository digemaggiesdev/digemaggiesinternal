UPDATE records
SET data = jsonb_set(data, '{status}', to_jsonb('In transit'::text)),
    updated_at = NOW()
WHERE kind = 'part_request'
  AND data->>'status' = 'In progress';