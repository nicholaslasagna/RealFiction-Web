package com.realfiction.realcore.halloween;

public record SpookyConditions(
    boolean night,
    boolean storm,
    boolean underground,
    boolean darkCave
) {
  public boolean any() {
    return night || storm || underground || darkCave;
  }

  public String summary() {
    StringBuilder builder = new StringBuilder();
    append(builder, "night", night);
    append(builder, "storm", storm);
    append(builder, "underground", underground);
    append(builder, "darkCave", darkCave);
    return builder.isEmpty() ? "none" : builder.toString();
  }

  private static void append(StringBuilder builder, String name, boolean enabled) {
    if (!enabled) {
      return;
    }
    if (!builder.isEmpty()) {
      builder.append(',');
    }
    builder.append(name);
  }
}
