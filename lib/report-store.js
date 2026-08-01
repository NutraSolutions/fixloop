const RETURNING = "returning id, public_id, status, created_at";

export async function insertReport(client, input) {
  const common = [
    input.clientRequestId,
    input.pageTitle,
    input.pageUrl,
    input.description,
    input.requestedRepository
  ];
  await client.query("savepoint fixloop_optional_field_insert");
  try {
    const inserted = await client.query(
      `insert into fixloop.reports
        (client_request_id, page_title, page_url, description, requested_repository, sender_identity)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (client_request_id)
       do update set
         client_request_id = excluded.client_request_id,
         sender_identity = coalesce(fixloop.reports.sender_identity, excluded.sender_identity)
       ${RETURNING}`,
      [...common, input.senderIdentity]
    );
    await client.query("release savepoint fixloop_optional_field_insert");
    return inserted;
  } catch (error) {
    await client.query("rollback to savepoint fixloop_optional_field_insert");
    await client.query("release savepoint fixloop_optional_field_insert");
    if (error?.code !== "42703" || input.senderIdentity) throw error;
    return client.query(
      `insert into fixloop.reports
        (client_request_id, page_title, page_url, description, requested_repository)
       values ($1, $2, $3, $4, $5)
       on conflict (client_request_id)
       do update set client_request_id = excluded.client_request_id
       ${RETURNING}`,
      common
    );
  }
}
