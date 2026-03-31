begin;

create sequence if not exists public.reference_report_ticket_seq;

alter table public.reference_report_claims
  add column if not exists ticket_code text;

alter table public.reference_report_claims
  alter column ticket_code
  set default ('CX-' || lpad(nextval('public.reference_report_ticket_seq')::text, 6, '0'));

update public.reference_report_claims
set ticket_code = 'CX-' || lpad(nextval('public.reference_report_ticket_seq')::text, 6, '0')
where ticket_code is null or btrim(ticket_code) = '';

alter table public.reference_report_claims
  alter column ticket_code set not null;

create unique index if not exists uq_reference_report_claims_ticket_code
  on public.reference_report_claims(ticket_code);

commit;
