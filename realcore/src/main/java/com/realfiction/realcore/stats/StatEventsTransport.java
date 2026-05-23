package com.realfiction.realcore.stats;

import com.realfiction.realcore.api.dto.StatEventsRequest;
import com.realfiction.realcore.api.dto.StatEventsResponse;
import java.util.concurrent.CompletableFuture;

/**
 * Narrow transport for {@link BufferedNetworkStatWriter}: a single async
 * function that POSTs a stat-events batch and returns the response.
 *
 * <p>In production this is a method reference to
 * {@code PlatformApiClient::postStatEvents}. In tests it is a lambda that
 * returns whatever future the test wants, so the writer can be exercised
 * without an HTTP client.
 */
@FunctionalInterface
public interface StatEventsTransport {
  CompletableFuture<StatEventsResponse> send(StatEventsRequest request);
}
