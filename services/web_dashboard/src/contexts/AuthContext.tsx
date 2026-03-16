/**
 * Authentication Context
 * Provides authentication state and methods throughout the app
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { AuthContextType, AuthUser, LoginCredentials } from '@/types'
import { api } from '@/lib/api'

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/**
 * Auth Provider Component
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(localStorage.getItem('access_token'))
  const [isLoading, setIsLoading] = useState(true)

  /**
   * Check if user has specific permission
   */
  const hasPermission = useCallback(
    (permission: string): boolean => {
      if (!user) return false
      if (user.role === 'admin') return true
      return user.permissions.includes(permission)
    },
    [user]
  )

  /**
   * Login function
   */
  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true)
    try {
      const authToken = await api.auth.login(credentials)

      // Store token
      setToken(authToken.access_token)

      // Fetch actual user info from server
      const response = await fetch('/api/v1/auth/me', {
        headers: {
          'Authorization': `Bearer ${authToken.access_token}`,
        },
      })

      if (!response.ok) {
        throw new Error('Failed to fetch user information')
      }

      const result = await response.json()
      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch user information')
      }

      const userData = result.data
      const userSession: AuthUser = {
        id: userData.id,
        username: userData.username,
        email: userData.email,
        role: userData.role,
        permissions: userData.permissions || [],
      }

      setUser(userSession)
    } catch (error) {
      console.error('Login failed:', error)
      setToken(null)
      setUser(null)
      throw error
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * Logout function
   */
  const logout = useCallback(async () => {
    try {
      await api.auth.logout()
    } finally {
      setUser(null)
      setToken(null)
    }
  }, [])

  /**
   * Initialize auth state from localStorage
   */
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem('access_token')
      if (storedToken) {
        setToken(storedToken)

        try {
          // Fetch actual user info from server
          const response = await fetch('/api/v1/auth/me', {
            headers: {
              'Authorization': `Bearer ${storedToken}`,
            },
          })

          if (response.ok) {
            const result = await response.json()
            if (result.success && result.data) {
              const userData = result.data
              const userSession: AuthUser = {
                id: userData.id,
                username: userData.username,
                email: userData.email,
                role: userData.role,
                permissions: userData.permissions || [],
              }
              setUser(userSession)
            }
          }
        } catch (error) {
          console.error('Failed to fetch user info:', error)
          // Clear invalid token
          setToken(null)
          localStorage.removeItem('access_token')
        }
      }
      setIsLoading(false)
    }

    initAuth()
  }, [])

  const value: AuthContextType = {
    user,
    token,
    login,
    logout,
    isAuthenticated: !!user,
    isLoading,
    hasPermission,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/**
 * Hook to use auth context
 */
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
