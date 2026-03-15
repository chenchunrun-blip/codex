import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { AgentsPageClient } from "@/components/agents/agents-page-client"

export default async function AgentsPage() {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }

  return (
    <DashboardLayout>
      <AgentsPageClient />
    </DashboardLayout>
  )
}
