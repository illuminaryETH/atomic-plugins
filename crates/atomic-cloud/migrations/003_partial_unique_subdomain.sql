-- Allow subdomain reuse after instance destruction.
ALTER TABLE instances DROP CONSTRAINT instances_subdomain_key;
CREATE UNIQUE INDEX idx_instances_active_subdomain ON instances(subdomain) WHERE status != 'destroyed';
