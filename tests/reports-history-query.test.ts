import { beforeEach, describe, expect, it, jest } from "@jest/globals"

jest.mock("@/lib/db", () => ({
  db: {
    activityLog: {
      findMany: jest.fn()
    }
  }
}))

const { db } = require("@/lib/db")
const dbMock = db as Record<string, any>
const { queryReportsHistory } = require("@/lib/reports/history-query")

describe("Reports History Query", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("includes bulk runner metadata types and filters non-report logs", async () => {
    const now = new Date("2026-03-14T10:00:00.000Z")
    dbMock.activityLog.findMany.mockResolvedValue([
      {
        createdAt: now,
        metadata: { type: "PROJECT_BULK_SCHEDULER_REPORT_SAVED" },
        file: { id: "f-scheduler", name: "scheduler-report.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Alice", email: "alice@example.com" }
      },
      {
        createdAt: now,
        metadata: { type: "PROJECT_BULK_STARTER_PACK_REPORT_SAVED" },
        file: { id: "f-starter", name: "starter-report.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Alice", email: "alice@example.com" }
      },
      {
        createdAt: now,
        metadata: { type: "FILE_CREATED_MANUAL" },
        file: { id: "f-manual", name: "manual.md" },
        project: { id: "p1", name: "Alpha" },
        user: { name: "Alice", email: "alice@example.com" }
      }
    ])

    const history = await queryReportsHistory({
      projectIds: ["p1"],
      limit: 20,
      offset: 0
    })

    expect(history).toHaveLength(2)
    expect(history.map((item: { type: string }) => item.type)).toEqual([
      "PROJECT_BULK_SCHEDULER_REPORT_SAVED",
      "PROJECT_BULK_STARTER_PACK_REPORT_SAVED"
    ])
  })
})

