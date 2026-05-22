package com.realfiction.realvotebridge;

import java.lang.reflect.Method;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;

public final class VoteEventAdapter {
  private VoteEventAdapter() {
  }

  public static Optional<VotePayload> fromEvent(Object event, Clock clock) {
    if (event == null) {
      return Optional.empty();
    }

    try {
      Object vote = invoke(event, "getVote");
      if (vote == null) {
        return Optional.empty();
      }

      String username = stringValue(invoke(vote, "getUsername"));
      String serviceName = stringValue(invoke(vote, "getServiceName"));
      String address = firstText(
          stringValue(invokeAny(vote, "getAddress", "getRemoteAddress", "getAddressRaw")),
          stringValue(invokeAny(event, "getAddress", "getRemoteAddress"))
      );
      Instant votedAt = parseInstant(invokeAny(vote, "getTimeStamp", "getTimestamp", "getTime"), clock);

      if (blank(username) || blank(serviceName)) {
        return Optional.empty();
      }

      return Optional.of(new VotePayload(serviceName.trim(), username.trim(), votedAt, blank(address) ? null : address.trim()));
    } catch (ReflectiveOperationException error) {
      return Optional.empty();
    }
  }

  private static Object invokeAny(Object target, String... methodNames) throws ReflectiveOperationException {
    for (String methodName : methodNames) {
      try {
        return invoke(target, methodName);
      } catch (NoSuchMethodException ignored) {
        // Try the next known NuVotifier/API spelling.
      }
    }
    return null;
  }

  private static Object invoke(Object target, String methodName) throws ReflectiveOperationException {
    Method method = target.getClass().getMethod(methodName);
    return method.invoke(target);
  }

  private static Instant parseInstant(Object raw, Clock clock) {
    String value = stringValue(raw);
    if (blank(value)) {
      return Instant.now(clock);
    }

    String trimmed = value.trim();
    try {
      long numeric = Long.parseLong(trimmed);
      if (trimmed.length() >= 13) {
        return Instant.ofEpochMilli(numeric);
      }
      return Instant.ofEpochSecond(numeric);
    } catch (NumberFormatException ignored) {
      // Try ISO-8601 below.
    }

    try {
      return Instant.parse(trimmed);
    } catch (RuntimeException ignored) {
      return Instant.now(clock);
    }
  }

  private static String firstText(String first, String second) {
    return blank(first) ? second : first;
  }

  private static String stringValue(Object value) {
    return value == null ? null : String.valueOf(value);
  }

  private static boolean blank(String value) {
    return value == null || value.isBlank();
  }
}
