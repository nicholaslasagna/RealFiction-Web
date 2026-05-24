package com.realfiction.realcore.api.dto;

public final class EconomyTransactionsResponse {
  public boolean ok;
  public String currencyKey;
  public String batchId;
  public int submitted;
  public int applied;
  public int duplicates;
  public boolean duplicateBatch;
  public int scale;
}
