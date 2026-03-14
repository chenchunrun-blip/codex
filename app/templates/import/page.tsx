import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { MarkdownImporter } from "@/components/templates/markdown-importer"

export default async function ImportTemplatePage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Import Markdown as Template</h1>
          <p className="mt-2 text-gray-600">Upload an existing markdown file to create a template</p>
        </div>

        <MarkdownImporter userId={session.user.id!} />
      </div>
    </div>
  )
}
