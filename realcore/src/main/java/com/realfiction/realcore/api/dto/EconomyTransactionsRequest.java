package com.realfiction.realcore.api.dto;

import java.util.List;
import java.util.Map;

public final class EconomyTransactionsRequest {
  public final String serverId;
  public final String serverGroup;
  public final String currencyKey;
  public final String batchId;
  public final List<Transaction> transactions;

  public EconomyTransactionsRequest(String serverId, String serverGroup, String currencyKey,
                                    String batchId, List<Transaction> transactions) {
    this.serverId = serverId;
    this.serverGroup = serverGroup;
    this.currencyKey = currencyKey;
    this.batchId = batchId;
    this.transactions = transactions;
  }

  public static final class Transaction {
    public final String minecraftUuid;
    public final String minecraftUsername;
    public final long amountMinor;
    public final String category;
    public final String reason;
    public final String idempotencyKey;
    public final String externalRefType;
    public final String externalRefId;
    public final Map<String, Object> metadata;

    public Transaction(String minecraftUuid, String minecraftUsername, long amountMinor, String category,
                       String reason, String idempotencyKey, String externalRefType, String externalRefId,
                       Map<String, Object> metadata) {
      this.minecraftUuid = minecraftUuid;
      this.minecraftUsername = minecraftUsername;
      this.amountMinor = amountMinor;
      this.category = category;
      this.reason = reason;
      this.idempotencyKey = idempotencyKey;
      this.externalRefType = externalRefType;
      this.externalRefId = externalRefId;
      this.metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
    }
  }
}
