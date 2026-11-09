import type { NodeTelemetryPacketDTO } from '../../dto';

/** Outbound port of the ingestion use case: told about every accepted telemetry event (Story 11.5, AD-28). */
export interface AnomalyObserverPort {
  observe(events: readonly NodeTelemetryPacketDTO[]): void;
}
