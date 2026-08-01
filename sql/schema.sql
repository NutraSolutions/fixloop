create extension if not exists pgcrypto;

create schema if not exists fixloop;

create table if not exists fixloop.reports (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default encode(gen_random_bytes(12), 'hex'),
  client_request_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  page_title text not null,
  page_url text not null,
  description text not null,
  requested_repository text,
  repository text,
  severity text not null default 'normal',
  status text not null default 'received',
  github_issue_number integer,
  github_issue_url text,
  pull_request_url text,
  deployment_url text,
  resolution_summary text,
  processing_attempts integer not null default 0,
  lease_until timestamptz,
  last_error text,
  constraint fixloop_report_status check (
    status in (
      'received', 'processing', 'needs_clarification', 'filed',
      'assigned', 'fixing', 'pull_request', 'deployed', 'verified', 'failed',
      'skipped'
    )
  ),
  constraint fixloop_report_severity check (
    severity in ('low', 'normal', 'high', 'critical')
  )
);

create table if not exists fixloop.attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references fixloop.reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  filename text not null,
  mime_type text not null,
  byte_size integer not null,
  sha256 text not null,
  content bytea not null,
  unique (report_id, sha256)
);

create table if not exists fixloop.events (
  id bigserial primary key,
  report_id uuid not null references fixloop.reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null,
  detail text
);

create index if not exists fixloop_reports_queue_idx
  on fixloop.reports (status, lease_until, created_at);

create index if not exists fixloop_reports_issue_idx
  on fixloop.reports (repository, github_issue_number);

create index if not exists fixloop_events_report_idx
  on fixloop.events (report_id, created_at);
