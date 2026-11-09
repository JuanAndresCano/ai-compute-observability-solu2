import type { CompositeIncident } from '../../domain/services/composite-incident-correlator';

/** Story 11.5: composite incidents that are still active (not silent for a full correlation window). */
export interface IncidentsPort {
  listActiveIncidents(): CompositeIncident[];
}
