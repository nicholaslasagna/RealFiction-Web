package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.dto.EconomyTransactionsRequest;
import com.realfiction.realcore.api.dto.EconomyTransactionsResponse;
import java.util.concurrent.CompletableFuture;

@FunctionalInterface
public interface EconomyTransactionsTransport {
  CompletableFuture<EconomyTransactionsResponse> send(EconomyTransactionsRequest request);
}
