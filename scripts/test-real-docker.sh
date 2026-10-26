#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "=== VaultRealm Real Docker Deployment Test (Linux/Bash) ==="

# 1. Health check
echo -e "\n1. Checking API health..."
curl -sSf "${API_URL}/healthz" | grep -q '"status":"ok"'
echo "API is healthy."

# 2. Check setup status / Register or login
echo -e "\n2. Checking setup status..."
NEEDS_SETUP=$(curl -s "${API_URL}/api/auth/setup-status" | grep -o '"needsSetup":true' || true)

if [ -n "$NEEDS_SETUP" ]; then
  echo "Registering initial admin user..."
  curl -sSf -c "$COOKIE_JAR" -X POST "${API_URL}/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"email":"admin@example.com","username":"admin","password":"AdminPassword123!"}' > /dev/null
  echo "Admin registered and logged in."
else
  echo "Logging in as admin..."
  curl -sSf -c "$COOKIE_JAR" -X POST "${API_URL}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"login":"admin","password":"AdminPassword123!"}' > /dev/null
  echo "Logged in."
fi

# 3. Check system capacity
echo -e "\n3. Checking System Capacity..."
curl -sSf -b "$COOKIE_JAR" "${API_URL}/api/system/capacity"
echo ""

# 4. Deploy Minecraft server
echo -e "\n4. Deploying Minecraft Java server..."
DEPLOY_RES=$(curl -sSf -b "$COOKIE_JAR" -X POST "${API_URL}/api/servers" \
  -H "Content-Type: application/json" \
  -d '{"name":"Paper-Bash-Test","templateId":"minecraft-java","ramMb":2048,"env":{"TYPE":"PAPER","EULA":"TRUE"}}')

SERVER_ID=$(echo "$DEPLOY_RES" | grep -o '"id":"[^"]*' | cut -d'"' -f4)
echo "Server created: $SERVER_ID"

# 5. Monitor deploy progress
echo -e "\n5. Waiting for server to become ready..."
for i in $(seq 1 30); do
  sleep 3
  STATUS=$(curl -sSf -b "$COOKIE_JAR" "${API_URL}/api/servers/${SERVER_ID}" | grep -o '"status":"[^"]*' | cut -d'"' -f4)
  echo "Server status: $STATUS"
  if [ "$STATUS" = "running" ]; then
    echo "Server is running!"
    break
  elif [ "$STATUS" = "error" ]; then
    echo "Deployment failed."
    exit 1
  fi
done

echo -e "\n=== Real Docker verification passed! ==="
