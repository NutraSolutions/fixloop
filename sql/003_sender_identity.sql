begin;

alter table fixloop.reports
  add column if not exists sender_identity text;

alter table fixloop.reports
  drop constraint if exists fixloop_sender_identity_length;

alter table fixloop.reports
  add constraint fixloop_sender_identity_length check (
    sender_identity is null or char_length(sender_identity) <= 320
  );

commit;
