import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { TemplateEditor } from "@/components/templates/template-editor"

export default async function EditTemplatePage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }

  const { id } = await params
  const template = await db.template.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      content: true,
      isPublic: true,
      isBuiltIn: true,
      creatorId: true
    }
  })
  if (!template) {
    redirect("/templates")
  }
  if (template.isBuiltIn || template.creatorId !== session.user.id) {
    redirect("/templates")
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Edit Template</h1>
          <p className="mt-2 text-gray-600">Update your reusable markdown template</p>
        </div>

        <TemplateEditor
          mode="edit"
          templateId={template.id}
          initialData={{
            name: template.name,
            description: template.description || "",
            category: template.category,
            content: template.content,
            isPublic: template.isPublic
          }}
        />
      </div>
    </div>
  )
}

