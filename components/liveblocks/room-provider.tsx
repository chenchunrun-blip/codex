"use client"

import { RoomProvider as LiveblocksRoomProvider } from "@liveblocks/react"
import { ClientSideSuspense } from "@liveblocks/react"
import { useEffect, useState } from "react"

interface RoomProviderProps {
  children: React.ReactNode
  roomId: string
  initialContent: string
}

export function RoomProvider({ children, roomId, initialContent }: RoomProviderProps) {
  return (
    <LiveblocksRoomProvider
      id={roomId}
      initialPresence={{
        cursor: null,
        selection: null,
      }}
    >
      <ClientSideSuspense fallback={<RoomLoadingFallback />}>
        <RoomContent>{children}</RoomContent>
      </ClientSideSuspense>
    </LiveblocksRoomProvider>
  )
}

function RoomContent({ children }: { children: React.ReactNode }) {
  const [storage, setStorage] = useState<any>(null)

  useEffect(() => {
    // This would normally come from Liveblocks storage
    // For now, we'll use local storage
    setStorage({
      markdown: ""
    })
  }, [])

  return <>{children}</>
}

function RoomLoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-gray-600">Connecting to real-time collaboration...</p>
      </div>
    </div>
  )
}
