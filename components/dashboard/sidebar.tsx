"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { useState, useEffect } from "react"
import { NotificationCenter } from "@/components/notifications/notification-center"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: "🏠" },
  { name: "Teams", href: "/teams", icon: "👥" },
  { name: "Projects", href: "/projects", icon: "📁" },
  { name: "Tasks", href: "/tasks", icon: "✅" },
  { name: "Agents", href: "/agents", icon: "🤖" },
  { name: "Templates", href: "/templates", icon: "📝" },
  { name: "Files", href: "/files", icon: "📄" },
  { name: "Operations", href: "/operations", icon: "🛠️" },
  { name: "Reports", href: "/reports", icon: "📚" },
  { name: "Settings", href: "/settings", icon: "⚙️" },
]

export function Sidebar() {
  const pathname = usePathname()
  const [user, setUser] = useState<{ name?: string | null; email?: string | null } | null>(null)

  useEffect(() => {
    // Fetch user session
    fetch("/api/auth/session")
      .then(res => res.json())
      .then(data => setUser(data))
      .catch(() => setUser(null))
  }, [])

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/" })
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white">
      {/* Logo */}
      <div className="flex items-center justify-center h-16 border-b border-gray-800">
        <span className="text-2xl mr-2">🔗</span>
        <h1 className="text-xl font-bold">MarqDex</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + "/")
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors
                ${isActive
                  ? "bg-blue-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
                }
              `}
            >
              <span className="mr-3 text-lg">{item.icon}</span>
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* User Info */}
      <div className="border-t border-gray-800 p-4">
        {/* Notification Center */}
        <div className="mb-4">
          {user && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-400">Notifications</span>
            </div>
          )}
          <div className="flex justify-center">
            {user ? (
              <NotificationCenter currentUserId={user.email || ''} />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-700 animate-pulse"></div>
            )}
          </div>
        </div>

        {user && (
          <div className="mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
              {(user.name || user.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {user.name || user.email?.split('@')[0] || 'User'}
              </p>
              <p className="text-xs text-gray-400 truncate">{user.email}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-300 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}
