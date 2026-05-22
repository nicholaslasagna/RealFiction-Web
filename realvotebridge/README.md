# RealVoteBridge

Velocity-side vote bridge for RealFiction.

## What It Does

RealVoteBridge listens for NuVotifier vote events on the Velocity proxy and forwards each vote to:

```text
https://realfiction.live/api/vote
```

It does not reward players directly. Rewards stay in the normal RealFiction path:

```text
Vote site -> Velocity NuVotifier -> RealVoteBridge -> RealFiction website -> reward queue -> RealCore -> in-game delivery
```

## Build

```bash
mvn -q -f realvotebridge/pom.xml clean package
```

Jar:

```text
realvotebridge/target/RealVoteBridge-0.1.0-SNAPSHOT.jar
```

## Install

1. Copy the jar to the Velocity proxy `plugins/` folder.
2. Restart the proxy once so `plugins/realvotebridge/config.yml` is created.
3. Edit the config:

```yaml
enabled: true
baseUrl: "https://realfiction.live"
serverId: "velocity"
hmacSecret: "same value as REALCORE_PLUGIN_SECRET"
requestTimeoutSeconds: 10
debug: false
```

4. Restart Velocity.

## Notes

- NuVotifier is optional. If it is missing, RealVoteBridge starts but stays idle.
- Never paste `hmacSecret` into chat, logs, screenshots, or public files.
- VotingPlugin rewards must stay disabled. RealCore is the only in-game reward delivery system.
- Velocity NuVotifier should be the only public vote receiver. Backend
  plugin-messaging forwarding is not needed for RealFiction rewards once
  RealVoteBridge is active. It is harmless only if no backend plugin consumes
  forwarded votes or gives rewards, but disabling it is cleaner and avoids
  noisy legacy vote paths.
