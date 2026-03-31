-- Allow re-subscriptions by replacing the UNIQUE constraint on customer_id
-- with a partial unique index that excludes destroyed instances.
ALTER TABLE instances DROP CONSTRAINT instances_customer_id_key;
CREATE UNIQUE INDEX idx_instances_active_customer ON instances(customer_id) WHERE status != 'destroyed';
