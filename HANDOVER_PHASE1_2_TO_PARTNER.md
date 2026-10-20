# Guía de Traspaso Colaborativo (Handover Fases 0–2 -> Fase 3)
## Proyecto: Academic AI Compute Fabric — Solu-2
### Módulo Asignado: **Module 11 — AI Infrastructure Observability Console**
**Modalidad:** Parejas (División 50/50 — Modelo Role-Swap de Unidad 4)  
**Autor del Handover:** Juand (Compañero A — Architect Lead)  
**Destinatario:** Compañero B (Lead Test Architect / Conductor de Murat TEA)  
**Fecha de Traspaso:** 2026-10-19  
**Estado:** **PRIMERA MITAD COMPLETADA AL 100% (LISTA PARA PRUEBAS TEA)**

---

## 1. Resumen Ejecutivo de la Primera Mitad

Siguiendo el plan de división equitativa 50/50, el **Compañero A (Juand)** ha completado y certificado la totalidad de la arquitectura, contratos, esquemas físicos y auditorías de las **Fases 0, 1 y 2**, cubriendo aproximadamente el **50% de la rúbrica oficial**.

Todas las decisiones se han blindado a nivel de máquina bajo el principio **"Design-by-Contract"**, eliminando cualquier adjetivo elástico y garantizando que el Compañero B pueda diseñar la estrategia de pruebas ATDD sin tener que adivinar ni inventar ningún comportamiento del sistema.

---

## 2. Inventario de Entregables Completados por el Compañero A

| Artefacto Generado | Fase | Descripción Técnica y Enlace |
|---|:---:|---|
| [`planning/ARCHITECTURE.md`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/planning/ARCHITECTURE.md#L56-L65) | **Fase 0** | Sección 1.1 actualizada con la declaración del Stack: TypeScript 5.x, Fastify/ws, SQLite 3, Vitest y pureza con `ClockPort`. |
| [`reviews/review-arch-implementability.md`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/reviews/review-arch-implementability.md) | **Fase 0** | Auditoría adversarial de implementabilidad con **8 brechas concretas triadas (ACCEPT)** asignadas entre A y B. |
| [`planning/detailed-design/contracts.md`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/planning/detailed-design/contracts.md) | **Fase 1** | Contratos formales $(P, Q, I)$ de las 3 operaciones nucleares (`ingestMetricBatch`, `evaluateAlertRule`, `buildUtilizationReport`), **Typed Error Catalog** (11 errores) e **Invariant Binding Table** (INV-01..08). |
| [`planning/detailed-design/ports-and-adapters.md`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/planning/detailed-design/ports-and-adapters.md) | **Fase 2** | Mapeo de capas hexagonales estrictas, reglas de pureza de dominio y **Diagrama Mermaid** con tags de capa en cada caja. |
| [`planning/detailed-design/schemas/001_observability_schema.sql`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/planning/detailed-design/schemas/001_observability_schema.sql) | **Fase 2** | Migración DDL SQLite con constraints físicos (`PRIMARY KEY (node_id, gpu_index)`, CHECKs de rangos, índice UNIQUE parcial de cooldown para alertas y tabla `audit_events`). |
| [`planning/detailed-design/schemas/dto.ts`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/planning/detailed-design/schemas/dto.ts) | **Fase 2** | DTOs de entrada y salida 100% tipados con primitivos TypeScript, `ErrorBodyDTO` y `ExplanationDTO`. Cero acoplamiento a frameworks web. |
| [`planning/detailed-design/schemas/events.md`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/planning/detailed-design/schemas/events.md) | **Fase 2** | Catálogo CloudEvents v1.0.2 con esquemas JSON de eventos ingeridos y emitidos (`eventId`, `occurredAt` en UTC ISO-8601 y `schemaVersion: "1.0.0"`). |
| [`planning/detailed-design/schemas/openapi.yaml`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/planning/detailed-design/schemas/openapi.yaml) | **Fase 2** | Especificación OpenAPI 3.0.3 completa para rutas HTTP/WS con schemas y respuestas de error del catálogo tipado. |
| [`reviews/review-detailed-design.md`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/reviews/review-detailed-design.md) | **Fase 2** | Gate Review de Fases 1–2 auditado con lentes adversarial y edge-case hunter. Veredicto: **PASS**. |
| [`ai-log/decision-log-solu2.md`](file:///c:/Universidad/Noveno%20Semestre/Desarrollo%20con%20IA/Solu%202/ai-log/decision-log-solu2.md) | **Transversal** | Entradas DEC-09, DEC-10 y DEC-11 registradas con atribución a **Juand (Partner A)** y **3 rechazos técnicos explícitos a la IA**. |

---

## 3. Instrucciones y Tareas para el Compañero B (Segunda Mitad)

¡Te toca el relevo! Como **Lead Test Architect**, tu misión en la **Fase 3** es conducir el framework **BMad TEA (Murat)** y construir la estrategia y suite de pruebas ejecutables en fase roja (*Red-Phase ATDD*).

### Tarea 3.1: Matriz de Riesgos (`test/test-design.md`)
* Ejecutar `/bmad-testarch-test-design`.
* Crear el registro de riesgos con $\ge 8$ riesgos calificados (Probabilidad 1–3, Impacto 1–3, Prioridad P0–P3).
* **Obligatorio:** El caso borde de la tormenta de telemetría de $5.000\text{ ev/s}$ (GAP-06 / INV-01) debe clasificarse obligatoriamente como **P0**.
* Definir umbrales de cobertura: 100% de contratos P0 cubiertos por $\ge 1$ test rojo; cobertura de líneas en `domain/` $\ge 90\%$.

### Tarea 3.2: Scaffolding de Fixtures Mandatorios (`test/fixtures/`)
Crear en TypeScript los 5 fixtures estipulados por el taller:
1. `fake_clock.ts`: Reloj determinístico con método `advanceBy(ms)` para avanzar tiempo virtual sin `sleep()`.
2. `seed_fleet.ts`: Perfil inmutable de la flota Plan-2: 31 Workstations ($1 \times 24\text{ GB}$) + 1 Central Server ($2 \times 48\text{ GB}$), todos en estado inicial `HEALTHY`.
3. `sim_telemetry.ts`: Inyector programable de telemetría sintética y fallos (simulador de silencio de `ws-gpu-22` y generador de burst de $5.000\text{ ev/s}$).
4. `db.ts`: Inicializador de SQLite in-memory que ejecuta `001_observability_schema.sql` antes de cada suite.
5. `explain_assert.ts`: Helper de aserciones que valida que las respuestas lleven `ExplanationDTO` con IDs de regla y valores observados.

### Tarea 3.3: Suite de Pruebas ATDD en Rojo (`test/atdd/observability_contracts.test.ts`)
* Ejecutar `/bmad-testarch-atdd`.
* Redactar al menos 2 tests por operación por cada categoría:
  * **Happy Path:** Postcondición $Q$ se cumple fielmente.
  * **Violación de Precondiciones:** Violación de $P$ arroja el error tipado correspondiente sin mutar la base de datos.
  * **Invariantes ($I$):** Verificación bajo concurrencia y límites de frontera.
  * **Caso Borde Mandatorio:** Ráfaga de $5.000\text{ ev/s}$ procesada a $\le 4\text{ Hz}$ sin superar memoria de $5.53\text{ MB}$.
  * **Explicabilidad:** Decisiones de alerta y reportes vacíos citan IDs de regla formales.
* **Regla Crítica:** Los tests deben llamar a los stubs de interfaces (que lanzan `NotImplementedError`) y **fallar en rojo por la razón correcta**. Las aserciones tautológicas como `expect(true).toBe(true)` están penalizadas con -5 pts cada una.

### Tarea 3.4 & 3.6: NFR Evidence & Matriz de Trazabilidad
* `test/nfr-evidence.md`: Métricas numéricas de Performance ($P_{95} \le 15\text{ ms}$ en ingesta, $\le 1.5\text{ s}$ en reporte), Reliability (timeout de 15s en `ws-gpu-22`) y Security.
* `test/traceability-matrix.md`: Mapeo cruzado de PRD FR/NFR $\to$ Escenario UX $\to$ AD-n $\to$ Cláusula de Contrato $\to$ Test ID $\to$ Story ID.

---

## 4. Tareas Finales en Conjunto (Fases 4 y 5)

Una vez completada la Fase 3, ambos nos reuniremos para:
1. **Redactar `planning/epics.md`:** 3–4 épicas verticales (9–16 historias) con formato Given/When/Then estricto.
2. **Ejecutar el Sprint Readiness Gate (`bmad-sprint-planning`):**
   * Validar que el gate arroje **PASS** y genere `implementation-artifacts/sprint-status.yaml`.
   * Realizar el **Gate Drill** obligatorio: romper deliberadamente un enlace, documentar el fallo y restaurarlo a PASS en `planning/readiness-gate-report.md`.
3. **Cerrar Gobernanza (`ai-log/decision-log-solu2.md`):**
   * El Compañero B registrará sus decisiones **DEC-12 a DEC-14** (con al menos 1 rechazo técnico justificado a la IA).
4. **Etiquetar la Entrega:**
   * `git tag solu2-ready`.
