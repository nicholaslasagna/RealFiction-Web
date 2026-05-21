package com.realfiction.realcore.scheduler;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

final class SchedulerFactoryTest {
  @Test
  void detectsPresentClassByName() {
    assertTrue(SchedulerFactory.isClassPresent("java.lang.String", getClass().getClassLoader()));
  }

  @Test
  void rejectsMissingClassByName() {
    assertFalse(SchedulerFactory.isClassPresent("com.realfiction.DoesNotExist", getClass().getClassLoader()));
  }
}
