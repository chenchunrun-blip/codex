import { auth } from "@/lib/auth/config"
import { redirect } from "next/navigation"
import { db } from "@/lib/db"
import { DashboardLayout } from "@/components/dashboard/dashboard-layout"
import { ProfileSettings } from "@/components/settings/profile-settings"
import { ApiKeySettings } from "@/components/settings/api-key-settings"
import { EmailVerification } from "@/components/settings/email-verification"
import { EmailPreferences } from "@/components/settings/email-preferences"

export default async function SettingsPage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      nickname: true,
      avatar: true,
      emailEnabled: true,
      emailVerified: true
    }
  })

  if (!user) {
    redirect("/login")
  }

  return (
    <DashboardLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-4xl xl:max-w-5xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-6 md:mb-8">Settings</h1>

        <div className="space-y-4 md:space-y-6">
          {/* Email Verification */}
          <EmailVerification email={user.email} emailVerified={user.emailVerified} />

          {/* Email Preferences */}
          <EmailPreferences emailEnabled={user.emailEnabled ?? true} />

          {/* Profile Settings */}
          <ProfileSettings user={user} />

          {/* AI API Key Settings */}
          <ApiKeySettings />

          {/* Other settings sections can be added here */}
          {/* Preferences, Notifications, etc. */}
        </div>
      </div>
    </DashboardLayout>
  )
}
