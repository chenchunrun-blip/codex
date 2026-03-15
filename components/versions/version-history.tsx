"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Version {
  id: string
  versionNumber: number
  content: string
  changeLog: string | null
  createdAt: string
  creator: {
    id: string
    name: string | null
    email: string
  }
}

interface VersionHistoryProps {
  fileId: string
  currentContent: string
  onRestore: (version: Version) => void
}

export function VersionHistory({ fileId, currentContent, onRestore }: VersionHistoryProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [versions, setVersions] = useState<Version[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<Version | null>(null)
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    if (isOpen) {
      fetchVersions()
    }
  }, [isOpen, fileId])

  const fetchVersions = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/versions?fileId=${fileId}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch versions"))
      }
      const data = await response.json()
      setVersions(data)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to fetch versions")
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestore = async () => {
    if (!selectedVersion) return

    if (confirm(`Restore to version ${selectedVersion.versionNumber}? This will replace current content.`)) {
      onRestore(selectedVersion)
      setIsOpen(false)
    }
  }

  const getDiff = (oldContent: string, newContent: string): string => {
    // Simple diff implementation
    const oldLines = oldContent.split("\n")
    const newLines = newContent.split("\n")
    const diff: string[] = []

    let i = 0
    let j = 0
    while (i < oldLines.length || j < newLines.length) {
      const oldLine = oldLines[i] || ""
      const newLine = newLines[j] || ""

      if (oldLine === newLine) {
        diff.push(`  ${oldLine}`)
        i++
        j++
      } else {
        if (i < oldLines.length) {
          diff.push(`- ${oldLine}`)
          i++
        }
        if (j < newLines.length) {
          diff.push(`+ ${newLine}`)
          j++
        }
      }
    }

    return diff.join("\n")
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Version History</h2>
        <p className="text-sm text-gray-500">{versions.length} versions</p>
      </div>

      {/* Version List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading versions...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-600">
            <p className="font-medium mb-2">Failed to load versions</p>
            <p className="text-sm mb-3">{error}</p>
            <button
              onClick={fetchVersions}
              className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        ) : versions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No versions yet</div>
        ) : (
          <div className="divide-y divide-gray-200">
            {versions.map((version) => (
              <div
                key={version.id}
                className={`p-4 hover:bg-gray-50 cursor-pointer ${
                  selectedVersion?.id === version.id ? "bg-blue-50" : ""
                }`}
                onClick={() => setSelectedVersion(version)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                      v{version.versionNumber}
                    </span>
                    <span className="text-sm text-gray-600">
                      {new Date(version.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedVersion(version)
                      handleRestore()
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    Restore
                  </button>
                </div>

                <div className="text-sm text-gray-700 break-words">
                  <span className="font-medium break-all">
                    {version.creator.name || version.creator.email}
                  </span>
                  {version.changeLog && (
                    <span className="text-gray-500 ml-2">
                      - {version.changeLog}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Version Detail Modal */}
      {selectedVersion && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1 mr-4">
                  <h3 className="text-lg font-semibold text-gray-900 break-words">
                    Version {selectedVersion.versionNumber}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 break-words">
                    {new Date(selectedVersion.createdAt).toLocaleString()} by{" "}
                    <span className="break-all">{selectedVersion.creator.name || selectedVersion.creator.email}</span>
                  </p>
                  {selectedVersion.changeLog && (
                    <p className="text-sm text-gray-600 mt-2 break-words">
                      {selectedVersion.changeLog}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedVersion(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setShowDiff(false)}
                  className={`px-3 py-1 text-sm font-medium rounded ${
                    !showDiff
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  View Content
                </button>
                <button
                  onClick={() => setShowDiff(true)}
                  className={`px-3 py-1 text-sm font-medium rounded ${
                    showDiff
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  View Diff
                </button>
              </div>

              <pre className="bg-gray-50 p-4 rounded-lg overflow-x-auto text-sm">
                {showDiff
                  ? getDiff(currentContent, selectedVersion.content)
                  : selectedVersion.content
                }
              </pre>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setSelectedVersion(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Close
              </button>
              <button
                onClick={handleRestore}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Restore This Version
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
