begin;

alter table fixloop.reports
  drop constraint if exists fixloop_report_status;

alter table fixloop.reports
  add constraint fixloop_report_status check (
    status in (
      'received', 'processing', 'needs_clarification', 'filed',
      'assigned', 'fixing', 'pull_request', 'deployed', 'verified', 'failed',
      'skipped'
    )
  );

commit;
