# Script interactivo de demostracion para el profesor - Modulo 11
# El script vive en la raiz del repositorio: funciona desde cualquier carpeta/maquina
$BASE_DIR = $PSScriptRoot
Set-Location -Path $BASE_DIR

$API_URL = "http://localhost:8080"

function Show-Header {
    Clear-Host
    Write-Host "==========================================================================" -ForegroundColor Cyan
    Write-Host "  MODULO 11: AI INFRASTRUCTURE OBSERVABILITY CONSOLE (DEMO EN VIVO)      " -ForegroundColor Yellow
    Write-Host "  ICESI - Desarrollo con IA                                                           " -ForegroundColor White
    Write-Host "==========================================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Wait-Enter {
    Write-Host ""
    Write-Host "Presiona [ENTER] para volver al menu..." -ForegroundColor DarkGray
    [void][System.Console]::ReadLine()
}

function Send-FleetBatch {
    param(
        [int]$minTemp = 52,
        [int]$tempSpread = 26,
        [switch]$includeCritical
    )

    $events = @()
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

    for ($i = 1; $i -le 31; $i++) {
        $pad = $i.ToString("D2")
        $nodeId = "ws-gpu-$pad"
        
        # Calcular temperatura variada
        $temp = $minTemp + ($i % $tempSpread)
        if ($includeCritical -and $nodeId -eq "ws-gpu-22") {
            $temp = 91 # Critico > 88 C
        }

        $events += @{
            node_id = $nodeId
            gpu_index = 0
            timestamp_ms = $now
            temperature_celsius = $temp
            vram_used_bytes = (4 + ($i % 8)) * 1073741824
            vram_total_bytes = 25769803776
            gpu_utilization_pct = 25 + ($i % 45)
            active_jobs_count = 1
            current_subject = "CS-480"
        }
    }

    $events += @{
        node_id = "server-gpu-01"
        gpu_index = 0
        timestamp_ms = $now
        temperature_celsius = 64
        vram_used_bytes = 16 * 1073741824
        vram_total_bytes = 51539607552
        gpu_utilization_pct = 70
        active_jobs_count = 4
        current_subject = "FAC-RES"
    }

    $payload = @{
        batch_id = [guid]::NewGuid().ToString()
        events = $events
    } | ConvertTo-Json -Depth 5

    try {
        $null = Invoke-RestMethod -Uri "$API_URL/v1/telemetry/batches" -Method Post -ContentType "application/json" -Body $payload
        return $true
    } catch {
        return $false
    }
}

do {
    Show-Header
    Write-Host "Flujo ordenado para la demostracion en vivo:" -ForegroundColor White
    Write-Host "--------------------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host " [0]  Reiniciar Todo Limpio (Docker Compose down -v, build y up)" -ForegroundColor Green
    Write-Host " [1]  Abrir Heatmap en el Navegador (Story 11.6 - Vista Web)" -ForegroundColor Cyan
    Write-Host " [2]  Simular Flota en Vivo (Variando Verde Normal y Amarillo Warm >= 75 C)" -ForegroundColor Blue
    Write-Host " [S]  *EXTRA*: Simulador Continuo en Tiempo Real (Actualiza cada 2 seg)" -ForegroundColor DarkCyan
    Write-Host " [3]  Inyectar Alerta Termica Critica (>88 C en ws-gpu-22 -> 91 C)" -ForegroundColor Red
    Write-Host " [4]  Aislar Nodo (Cordon ws-gpu-22 via API) y Ver Auditoria" -ForegroundColor Magenta
    Write-Host " [5]  Consultar Reporte Ejecutivo de Utilizacion de Cluster (7 Dias)" -ForegroundColor Yellow
    Write-Host " [6]  Ejecutar Tests E2E y Accesibilidad WCAG (Flow E Playwright)" -ForegroundColor Cyan
    Write-Host " [7]  Ejecutar Quality Gate: Cobertura de Ramas (>90% Branch Coverage)" -ForegroundColor Yellow
    Write-Host " [8]  Ejecutar Suite Completa de Tests y Pureza Arquitectonica (Vitest)" -ForegroundColor Green
    Write-Host " [Q]  Salir" -ForegroundColor Gray
    Write-Host "--------------------------------------------------------------------------" -ForegroundColor DarkGray
    $choice = Read-Host "Elige una opcion [0-8, S, Q]"

    switch ($choice.ToUpper()) {
        "0" {
            Show-Header
            Write-Host ">> PASO 0: Deteniendo contenedores, borrando volumenes y levantando de 0..." -ForegroundColor Yellow
            docker compose down -v
            docker compose up -d --build
            Write-Host "`n>> Esperando a que el servicio este listo..." -ForegroundColor Yellow
            $ready = $false
            for ($i = 0; $i -lt 15; $i++) {
                try {
                    $res = Invoke-RestMethod -Uri "$API_URL/health" -TimeoutSec 2 -ErrorAction Stop
                    if ($res.status -eq "ok") {
                        $ready = $true
                        break
                    }
                } catch {
                    Start-Sleep -Seconds 1
                }
            }
            if ($ready) {
                Write-Host ">> Servicio desplegado y listo en $API_URL!" -ForegroundColor Green
                $null = Send-FleetBatch -minTemp 52 -tempSpread 26
            } else {
                Write-Host ">> Advertencia: El servicio tardo en responder. Revisa docker ps." -ForegroundColor Red
            }
            Wait-Enter
        }

        "1" {
            Show-Header
            Write-Host ">> PASO 1: Abriendo Fleet Thermal Heatmap en tu navegador..." -ForegroundColor Cyan
            Start-Process "$API_URL/observability/heatmap"
            Write-Host ""
            Write-Host "Explicacion para el profesor:" -ForegroundColor Yellow
            Write-Host " - Muestra 32 celdas: 31 estaciones de computo (ws-gpu-01 a ws-gpu-31) y el servidor (server-gpu-01)."
            Write-Host " - Cada celda se actualiza por polling cada 2 s sobre /api/v1/metrics/heatmap."
            Write-Host " - El WebSocket /ws/telemetry del backend entrega los frames de 10 Hz; esta vista no lo consume."
            Wait-Enter
        }

        "2" {
            Show-Header
            Write-Host ">> PASO 2: Inyectando telemetria con nodos normales (Verde <75 C) y tibios (Amarillo >= 75 C)..." -ForegroundColor Blue
            # Esto producira nodos de 55 C hasta 80 C (superando 75 C para activar Warm)
            $ok = Send-FleetBatch -minTemp 55 -tempSpread 26
            if ($ok) {
                Write-Host ">> [OK] Telemetria de flota enviada exitosamente." -ForegroundColor Green
                Write-Host "`nObserva el navegador:" -ForegroundColor Yellow
                Write-Host " - Nodos < 75 C estan en VERDE (Normal)."
                Write-Host " - Nodos entre 75 C y 80 C (como ws-gpu-20, ws-gpu-21, etc.) estan en AMARILLO (Warm >= 75 C)."
            } else {
                Write-Host "Error enviando telemetria." -ForegroundColor Red
            }
            Wait-Enter
        }

        "S" {
            Show-Header
            Write-Host ">> MODO STREAMING EN VIVO (Simulador en tiempo real)..." -ForegroundColor DarkCyan
            Write-Host "Enviando pulsos de telemetria variando temperaturas cada 2 segundos." -ForegroundColor Yellow
            Write-Host "Mira como oscilan los graficos y las celdas en el navegador en tiempo real." -ForegroundColor Yellow
            Write-Host "Presiona [Ctrl + C] para detener el simulador y volver al menu.`n" -ForegroundColor DarkGray
            
            try {
                $pulse = 0
                while ($true) {
                    $pulse++
                    $base = 54 + ($pulse % 8)
                    $null = Send-FleetBatch -minTemp $base -tempSpread 26
                    Write-Host "Pulsacion $pulse enviada: Temperatura base $base C (nodos entre $base C y $($base+25) C)..." -ForegroundColor Cyan
                    Start-Sleep -Seconds 2
                }
            } catch {
                Write-Host "`nSimulador detenido." -ForegroundColor Yellow
            }
            Wait-Enter
        }

        "3" {
            Show-Header
            Write-Host ">> PASO 3: Inyectando telemetria critica en ws-gpu-22 (91 C, sobrecalentamiento)..." -ForegroundColor Red
            
            $payload = @{
                batch_id = [guid]::NewGuid().ToString()
                events = @(
                    @{
                        node_id = "ws-gpu-22"
                        gpu_index = 0
                        timestamp_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                        temperature_celsius = 91
                        vram_used_bytes = 12000000000
                        vram_total_bytes = 25769803776
                        gpu_utilization_pct = 98
                        active_jobs_count = 3
                        current_subject = "deep-learning"
                    }
                )
            } | ConvertTo-Json -Depth 5

            try {
                $res = Invoke-RestMethod -Uri "$API_URL/v1/telemetry/batches" -Method Post -ContentType "application/json" -Body $payload
                Write-Host ">> Telemetria aceptada exitosamente por el cluster:" -ForegroundColor Green
                $res | Format-List
                Write-Host "`nObserva la pantalla del navegador:" -ForegroundColor Yellow
                Write-Host " - La celda ws-gpu-22 cambio inmediatamente a ROJO TITILANTE (alerta mayor a 88 C)."
                Write-Host " - Haz clic en la celda para abrir el Drawer de diagnostico."
            } catch {
                Write-Host "Error enviando telemetria: $_" -ForegroundColor Red
            }
            Wait-Enter
        }

        "4" {
            Show-Header
            Write-Host ">> PASO 4: Aislando nodo ws-gpu-22 (Cordoning) via caso de uso hexagonal..." -ForegroundColor Magenta
            
            try {
                $cordonRes = Invoke-RestMethod -Uri "$API_URL/v1/nodes/ws-gpu-22/cordon" -Method Post -ContentType "application/json"
                Write-Host ">> Respuesta de Aislamiento (NodeCordonService):" -ForegroundColor Green
                $cordonRes | Format-List

                Write-Host "`n>> Consultando feed de eventos de auditoria (/v1/audit-events):" -ForegroundColor Cyan
                $auditRes = Invoke-RestMethod -Uri "$API_URL/v1/audit-events"
                $auditRes.events | Select-Object -First 5 | Format-Table -AutoSize

                Write-Host "`nObserva el navegador:" -ForegroundColor Yellow
                Write-Host " - La celda ws-gpu-22 se vuelve GRIS con el icono de candado y etiqueta CORDONED."
                Write-Host " - En el panel Activity Feed (a la derecha) se muestra la entrada de auditoria del cordon."
            } catch {
                Write-Host "Error al aislar nodo: $_" -ForegroundColor Red
            }
            Wait-Enter
        }

        "5" {
            Show-Header
            Write-Host ">> PASO 5: Generando Reporte Ejecutivo de Utilizacion (Epic 4)..." -ForegroundColor Yellow
            
            $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $from = $now - (7 * 24 * 3600 * 1000) # Ultimos 7 dias

            try {
                $report = Invoke-RestMethod -Uri "$API_URL/v1/reports/utilization?from_timestamp_ms=$from&to_timestamp_ms=$now&subjects=ALL"
                Write-Host ">> Reporte Ejecutivo generado:" -ForegroundColor Green
                Write-Host "ID del reporte : $($report.report_id)"
                Write-Host "Generado en ms : $($report.generated_at_ms)"
                Write-Host "Ventana (horas): $($report.query_window.duration_hours)"
                Write-Host "Regla aplicada : $($report.explanation.rule_id)"
                Write-Host "Justificacion  : $($report.explanation.justification_text)"
                Write-Host "`nExplicacion para el profesor:" -ForegroundColor Cyan
                Write-Host " - En un cluster recien arrancado (desde cero con Docker), este resultado 'Honest Empty State'"
                Write-Host "   demuestra el cumplimiento de la regla AD-06: no inventa métricas ficticias cuando"
                Write-Host "   no hay cargas de trabajo históricas en la ventana consultada."
            } catch {
                Write-Host "Error al obtener reporte: $_" -ForegroundColor Red
            }
            Wait-Enter
        }

        "6" {
            Show-Header
            Write-Host ">> PASO 6: Ejecutando pruebas E2E y Accesibilidad WCAG (Playwright Flow E)..." -ForegroundColor Cyan
            npm run test:e2e
            Wait-Enter
        }

        "7" {
            Show-Header
            Write-Host ">> PASO 7: Validando Cobertura de Ramas (>90% Branch Coverage Gate)..." -ForegroundColor Yellow
            npm run test:coverage
            Wait-Enter
        }

        "8" {
            Show-Header
            Write-Host ">> PASO 8: Ejecutando Suite de Tests Unitarios, Integracion y Pureza de Capas..." -ForegroundColor Green
            npm test
            Wait-Enter
        }
    }
} while ($choice.ToUpper() -ne "Q")

Show-Header
Write-Host "Demostracion finalizada. Exitos en la presentacion!" -ForegroundColor Green