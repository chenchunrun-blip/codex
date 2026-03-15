import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { TasksPageClient } from "@/components/tasks/tasks-page-client"

export default async function TasksPage() {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }

  return (
    <DashboardLayout>
      <TasksPageClient />
    </DashboardLayout>
  )
}
