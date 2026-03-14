import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { FileImporter } from "@/components/files/file-importer"

export default async function ImportFilePage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  // Get user's projects for the dropdown
  const projects = await db.project.findMany({
    where: {
      members: {
        some: { userId: session.user.id }
      }
    },
    include: {
      team: {
        select: {
          name: true
        }
      }
    },
    orderBy: { name: 'asc' }
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Import Markdown File</h1>
          <p className="mt-2 text-gray-600">Upload an existing markdown file to your project</p>
        </div>

        <FileImporter
          userId={session.user.id!}
          projects={projects}
        />
      </div>
    </div>
  )
}
