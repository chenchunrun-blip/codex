import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { OperationsPageClient } from "@/components/operations/operations-page-client"

export default async function OperationsPage() {
  const session = await auth()
  if (!session?.user) {
    redirect("/login")
  }

  return (
    <DashboardLayout>
      <OperationsPageClient />
    </DashboardLayout>
  )
}
