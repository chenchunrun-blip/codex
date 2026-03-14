"use client"

type TemplateCatalogItem = {
  id: string
  name: string
  category: string
  isBuiltIn: boolean
  usageCount: number
  updatedAt: string
}

interface ExportTemplatesCatalogButtonProps {
  templates: TemplateCatalogItem[]
}

export function ExportTemplatesCatalogButton({ templates }: ExportTemplatesCatalogButtonProps) {
  const exportCatalog = () => {
    const lines: string[] = []
    lines.push("# Templates Catalog Report")
    lines.push("")
    lines.push(`- Generated At: ${new Date().toISOString()}`)
    lines.push(`- Templates: ${templates.length}`)
    lines.push("")
    lines.push("| Template | Category | Built-in | Used | Updated At |")
    lines.push("| --- | --- | --- | --- | --- |")
    for (const template of templates) {
      lines.push(
        `| ${template.name.replace(/\|/g, "\\|")} | ${template.category} | ${template.isBuiltIn ? "yes" : "no"} | ${template.usageCount} | ${new Date(template.updatedAt).toISOString()} |`
      )
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    anchor.href = url
    anchor.download = `templates-catalog-${stamp}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      type="button"
      onClick={exportCatalog}
      disabled={templates.length === 0}
      className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      Export Templates
    </button>
  )
}
