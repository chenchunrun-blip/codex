import { describe, expect, it } from "@jest/globals"
import {
  REPORT_METADATA_TYPES,
  isReportMetadataType,
  reportMetadataTypeLabel
} from "@/lib/reports/metadata"

describe("Reports Metadata", () => {
  it("includes operations status report type in metadata registry", () => {
    expect(REPORT_METADATA_TYPES).toContain("OPERATIONS_STATUS_REPORT_SAVED")
    expect(isReportMetadataType("OPERATIONS_STATUS_REPORT_SAVED")).toBe(true)
    expect(reportMetadataTypeLabel("OPERATIONS_STATUS_REPORT_SAVED")).toBe("Operations Status Report")
  })

  it("includes bulk runner report types in metadata registry", () => {
    expect(REPORT_METADATA_TYPES).toContain("PROJECT_BULK_STARTER_PACK_REPORT_SAVED")
    expect(REPORT_METADATA_TYPES).toContain("PROJECT_BULK_SCHEDULER_REPORT_SAVED")
    expect(isReportMetadataType("PROJECT_BULK_STARTER_PACK_REPORT_SAVED")).toBe(true)
    expect(isReportMetadataType("PROJECT_BULK_SCHEDULER_REPORT_SAVED")).toBe(true)
    expect(reportMetadataTypeLabel("PROJECT_BULK_STARTER_PACK_REPORT_SAVED")).toBe(
      "Bulk Starter Pack Runner Report"
    )
    expect(reportMetadataTypeLabel("PROJECT_BULK_SCHEDULER_REPORT_SAVED")).toBe(
      "Bulk Scheduler Runner Report"
    )
  })

  it("returns original string for unknown metadata type", () => {
    expect(isReportMetadataType("UNKNOWN_TYPE")).toBe(false)
    expect(reportMetadataTypeLabel("UNKNOWN_TYPE")).toBe("UNKNOWN_TYPE")
  })
})
