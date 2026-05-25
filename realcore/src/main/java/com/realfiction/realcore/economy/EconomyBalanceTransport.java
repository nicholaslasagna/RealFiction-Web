package com.realfiction.realcore.economy;

import com.realfiction.realcore.api.dto.EconomyBalanceRequest;
import com.realfiction.realcore.api.dto.EconomyBalanceResponse;
import java.util.concurrent.CompletableFuture;

@FunctionalInterface
interface EconomyBalanceTransport {
  CompletableFuture<EconomyBalanceResponse> fetch(EconomyBalanceRequest request);
}
