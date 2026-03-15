import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { MarkdownEditor } from "@/components/editor/markdown-editor"
import { CommentsPanel } from "@/components/comments/comments-panel"

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const file = await db.file.findUnique({
    where: { id },
    include: {
      project: {
        include: {
          members: true
        }
      },
      creator: true
    }
  })

  if (!file) {
    redirect("/files")
  }

  // Check if user has access to this file
  const hasAccess = file.project.members.some(m => m.userId === session.user!.id)
  if (!hasAccess) {
    redirect("/files")
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{file.name}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {file.project.name} • Created by {file.creator.name || file.creator.email}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <a
              href={`/api/files/${file.id}/export/md`}
              download={`${file.name}.md`}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Export .md
            </a>
            <a
              href={`/api/files/${file.id}/export/pdf`}
              download={`${file.name}.pdf`}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              Export PDF
            </a>
          </div>
        </div>

        {/* Editor with Comments */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <MarkdownEditor
              fileId={file.id}
              projectId={file.projectId}
              fileName={file.name}
              initialContent={file.content}
              projectName={file.project.name}
            />
          </div>

          {/* Comments Panel - Right Sidebar */}
          <div className="w-96 border-l border-gray-200 bg-white overflow-y-auto">
            <CommentsPanel
              fileId={file.id}
              projectId={file.projectId}
              currentUserId={session.user.id}
            />
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
