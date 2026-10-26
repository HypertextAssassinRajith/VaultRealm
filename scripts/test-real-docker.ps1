# Manual Test Script for Real Docker Deployment (Phase 2)
# Run this on a machine with Docker Engine running.

param(
    [string]$ApiUrl = "http://localhost:3001"
)

$ErrorActionPreference = "Stop"

Write-Host "=== VaultRealm Real Docker Deployment Test ===" -ForegroundColor Cyan

# 1. Health check
Write-Host "`n1. Checking API health..."
$health = Invoke-RestMethod -Uri "$ApiUrl/healthz" -Method Get
Write-Host "API Status: $($health.status) (v$($health.version))" -ForegroundColor Green

# 2. Check setup status / Register admin
Write-Host "`n2. Checking setup status..."
$setup = Invoke-RestMethod -Uri "$ApiUrl/api/auth/setup-status" -Method Get
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

if ($setup.needsSetup) {
    Write-Host "Registering initial admin user..."
    $regBody = @{
        email = "admin@example.com"
        username = "admin"
        password = "AdminPassword123!"
    } | ConvertTo-Json

    $regRes = Invoke-RestMethod -Uri "$ApiUrl/api/auth/register" -Method Post -Body $regBody -ContentType "application/json" -WebSession $session
    Write-Host "Admin registered: $($regRes.username) ($($regRes.id))" -ForegroundColor Green
} else {
    Write-Host "Logging in as admin..."
    $loginBody = @{
        login = "admin"
        password = "AdminPassword123!"
    } | ConvertTo-Json

    $loginRes = Invoke-RestMethod -Uri "$ApiUrl/api/auth/login" -Method Post -Body $loginBody -ContentType "application/json" -WebSession $session
    Write-Host "Logged in: $($loginRes.username)" -ForegroundColor Green
}

# 3. Check Capacity
Write-Host "`n3. Checking System Capacity..."
$capacity = Invoke-RestMethod -Uri "$ApiUrl/api/system/capacity" -Method Get -WebSession $session
Write-Host "Host RAM: $($capacity.host.totalHostRamMb) MB (Budget: $($capacity.host.budgetRamMb) MB, Available: $($capacity.host.availableBudgetRamMb) MB)" -ForegroundColor Green
Write-Host "User Quota: $($capacity.user.serverCount)/$($capacity.user.quotaServers) servers, $($capacity.user.ramMb)/$($capacity.user.quotaRamMb) MB RAM" -ForegroundColor Green

# 4. List Templates
Write-Host "`n4. Fetching Game Templates..."
$templates = Invoke-RestMethod -Uri "$ApiUrl/api/templates" -Method Get -WebSession $session
Write-Host "Available templates: $(($templates | ForEach-Object { $_.name }) -join ', ')" -ForegroundColor Green

# 5. One-Click Deploy Minecraft Server
Write-Host "`n5. Deploying Minecraft Java Server..."
$deployBody = @{
    name = "Paper-Real-Test"
    templateId = "minecraft-java"
    ramMb = 2048
    env = @{
        TYPE = "PAPER"
        EULA = "TRUE"
        MOTD = "VaultRealm Real Docker Test"
    }
} | ConvertTo-Json

$deployRes = Invoke-RestMethod -Uri "$ApiUrl/api/servers" -Method Post -Body $deployBody -ContentType "application/json" -WebSession $session
$serverId = $deployRes.id
Write-Host "Server created! ID: $serverId, Status: $($deployRes.status)" -ForegroundColor Green

# 6. Stream Events / Poll Status
Write-Host "`n6. Monitoring deployment progress events..."
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $server = Invoke-RestMethod -Uri "$ApiUrl/api/servers/$serverId" -Method Get -WebSession $session
    Write-Host "Status: $($server.status)"
    
    $events = Invoke-RestMethod -Uri "$ApiUrl/api/servers/$serverId/events" -Method Get -WebSession $session
    if ($events.Count -gt 0) {
        $latest = $events[0]
        Write-Host "  Latest Event [$($latest.kind)]: $($latest.message)" -ForegroundColor DarkGray
    }

    if ($server.status -eq "running") {
        Write-Host "`nServer is RUNNING!" -ForegroundColor Green
        Write-Host "Ports:"
        foreach ($p in $server.ports) {
            Write-Host "  - $($p.name): host port $($p.hostPort) -> container port $($p.containerPort)/$($p.protocol)"
        }
        break
    } elseif ($server.status -eq "error") {
        Write-Host "`nServer entered ERROR state." -ForegroundColor Red
        break
    }
}

# 7. Test Power Controls
Write-Host "`n7. Testing Power Controls..."
Write-Host "Stopping server..."
$null = Invoke-RestMethod -Uri "$ApiUrl/api/servers/$serverId/stop" -Method Post -WebSession $session
Start-Sleep -Seconds 2
$server = Invoke-RestMethod -Uri "$ApiUrl/api/servers/$serverId" -Method Get -WebSession $session
Write-Host "Status after stop: $($server.status)" -ForegroundColor Green

Write-Host "Starting server..."
$null = Invoke-RestMethod -Uri "$ApiUrl/api/servers/$serverId/start" -Method Post -WebSession $session
Start-Sleep -Seconds 2
$server = Invoke-RestMethod -Uri "$ApiUrl/api/servers/$serverId" -Method Get -WebSession $session
Write-Host "Status after start: $($server.status)" -ForegroundColor Green

Write-Host "`n=== Phase 2 Real Docker Verification Completed! ===" -ForegroundColor Cyan
