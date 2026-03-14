import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { TemplateEditor } from "@/components/templates/template-editor"

export default async function NewTemplatePage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Create Custom Template</h1>
          <p className="mt-2 text-gray-600">Design your own template for future use</p>
        </div>

        <TemplateEditor mode="create" />
      </div>
    </div>
  )
}
