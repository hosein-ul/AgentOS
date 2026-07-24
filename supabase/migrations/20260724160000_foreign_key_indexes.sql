-- Cover foreign keys used by deletes and tenant/resource lookups.
-- Additive only; no indexes are dropped.

create index if not exists legacy_attachment_email_idx
  on public."Attachment"("emailId");
create index if not exists legacy_email_template_user_idx
  on public."EmailTemplate"("userId");

create index if not exists v1_calls_phone_number_idx
  on public.v1_calls(phone_number_id);
create index if not exists v1_dns_records_domain_idx
  on public.v1_dns_records(domain_id);
create index if not exists v1_dns_records_tenant_idx
  on public.v1_dns_records(tenant_id);
create index if not exists v1_domains_tenant_idx
  on public.v1_domains(tenant_id);
create index if not exists v1_jobs_tenant_idx
  on public.v1_jobs(tenant_id);
create index if not exists v1_phone_entitlements_payment_idx
  on public.v1_phone_entitlements(payment_id)
  where payment_id is not null;
