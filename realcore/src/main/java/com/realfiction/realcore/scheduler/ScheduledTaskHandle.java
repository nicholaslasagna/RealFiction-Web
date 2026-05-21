package com.realfiction.realcore.scheduler;

@FunctionalInterface
public interface ScheduledTaskHandle {
  void cancel();
}
