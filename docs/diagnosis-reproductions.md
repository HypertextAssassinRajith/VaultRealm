# Failing-Server Reproduction Recipes (Phase 3 Diagnosis Engine)

This document provides step-by-step reproduction recipes for each of the 8 diagnosis rules implemented in VaultRealm (§9.3).

---

### 1. `oom-killed` (Out of Memory)
- **Reproduction**:
  Deploy a Minecraft Paper server with RAM set to 256 MB (well below minimum requirements):
  ```json
  POST /api/servers
  {
    "name": "Broken-OOM",
    "templateId": "minecraft-java",
    "ramMb": 256,
    "env": { "MEMORY": "256M", "EULA": "TRUE" }
  }
  ```
- **Symptom**: JVM crashes with `java.lang.OutOfMemoryError` or exit code `137`.
- **Finding**: `"Server ran out of memory (OOM)"`
- **Fix Button**: One-click action `raise-ram` (sets RAM to 1280 MB+ and restarts).

---

### 2. `port-in-use` (Port Conflict)
- **Reproduction**:
  Start a dummy listener on the server's allocated host port (e.g., `nc -l 25565` or Python `python -m http.server 25565`), then start the server.
- **Symptom**: Server logs `**** FAILED TO BIND TO PORT! Address already in use`.
- **Finding**: `"Port is already in use by another service"`
- **Fix Button**: One-click action `change-port` (dynamically assigns a new free port from `PORT_RANGE`).

---

### 3. `eula-not-accepted` (Minecraft EULA)
- **Reproduction**:
  Deploy a Minecraft server with `EULA` explicitly set to `FALSE`:
  ```json
  POST /api/servers
  {
    "name": "Broken-EULA",
    "templateId": "minecraft-java",
    "env": { "EULA": "FALSE" }
  }
  ```
- **Symptom**: Server halts with `You need to agree to the EULA in order to run the server`.
- **Finding**: `"Minecraft EULA has not been accepted"`
- **Fix Button**: One-click action `set-env` with `{ "EULA": "TRUE" }`.

---

### 4. `java-version` (Incompatible Java Runtime)
- **Reproduction**:
  Deploy a modern Paper 1.20.4+ jar using a legacy Java runtime tag (e.g. Java 11 or 17 when Java 21 is required).
- **Symptom**: Server fails with `java.lang.UnsupportedClassVersionError: ... has been compiled by a more recent version of the Java Runtime`.
- **Finding**: `"Incompatible Java Runtime version"`
- **Fix Button**: One-click action `set-env` switching container image to Java 21 runtime.

---

### 5. `permission-denied` (Volume Permissions)
- **Reproduction**:
  Revoke write permissions on the server's data folder on the host:
  ```bash
  chmod 000 /srv/gamepanel/data/servers/<serverId>
  ```
- **Symptom**: Container logs `java.io.FileNotFoundException: server.properties (Permission denied)`.
- **Finding**: `"Storage volume permission denied"`
- **Fix Button**: One-click action `chown-volume` (restores container UID ownership and 0755 permissions).

---

### 6. `disk-full` (Storage Exhaustion)
- **Reproduction**:
  Mount a full loopback device or generate a zero-space test condition where `write` returns `ENOSPC`.
- **Symptom**: Server logs `java.io.IOException: No space left on device`.
- **Finding**: `"Host storage disk is full"`
- **Fix Button**: Action `clean-disk` (removes expired backups and trims rotated logs).

---

### 7. `crash-loop` (Rapid Failure Cycle)
- **Reproduction**:
  Provide a corrupted server configuration or missing essential library that causes immediate exit code 1 upon launch three times consecutively within 5 minutes.
- **Symptom**: Event timeline records ≥3 container exit events in <5 minutes.
- **Finding**: `"Server is caught in a crash loop"`
- **Fix Button**: Action `restart` with `pauseRestartPolicy: true` to halt flapping.

---

### 8. `no-ready-signal` (Readiness Timeout)
- **Reproduction**:
  Configure a server with a simulated network stall or hanging startup task that runs indefinitely without outputting `Done (..s)!`.
- **Symptom**: Deployment step 8 or event tracker logs `Ready signal timed out after 300 seconds without match`.
- **Finding**: `"Server startup timed out waiting for ready signal"`
- **Fix Button**: Action `restart` with extended timeout or documentation guidance.
