import type { ReportQueryDTO, ExecutiveReportDTO } from '../../dto';

/** contracts.md Operation 3. */
export interface ReportingPort {
  buildUtilizationReport(query: ReportQueryDTO): Promise<ExecutiveReportDTO>;
}
