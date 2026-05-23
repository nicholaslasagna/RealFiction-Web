package com.realfiction.realcore.api.dto;

/**
 * Response body for {@code POST /api/plugin/stats/events}.
 *
 * <p>{@link #duplicate} is true when the website found the {@code batchId} in
 * its idempotency ledger and skipped re-applying. {@link #applied} reflects how
 * many events were applied this call (0 on duplicate). Fields are non-final and
 * package-default-init so Gson can populate them.
 */
public final class StatEventsResponse {
  public boolean ok;
  public int applied;
  public boolean duplicate;
  public int submitted;
  public String batchId;
}
