/**
 * WebSocket hook for real-time updates
 */

import { useEffect, useRef, useState } from 'react'
import { logger } from '@/lib/utils'

interface WebSocketMessage {
  type: string
  message?: string
  data?: any
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void
  onConnect?: () => void
  onDisconnect?: () => void
  reconnectInterval?: number
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false)
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const { onMessage, onConnect, onDisconnect, reconnectInterval = 5000 } = options

  const connect = () => {
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}/ws`

      logger.info(`Connecting to WebSocket: ${wsUrl}`)
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        logger.info('WebSocket connected')
        setIsConnected(true)
        onConnect?.()
      }

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data)
          logger.debug('WebSocket message received:', message.type)
          setLastMessage(message)
          onMessage?.(message)
        } catch (error) {
          logger.error('Failed to parse WebSocket message:', error)
        }
      }

      ws.onclose = () => {
        logger.info('WebSocket disconnected')
        setIsConnected(false)
        onDisconnect?.()

        // Attempt to reconnect
        reconnectTimeoutRef.current = setTimeout(() => {
          logger.info('Attempting to reconnect...')
          connect()
        }, reconnectInterval)
      }

      ws.onerror = (error) => {
        logger.error('WebSocket error:', error)
      }
    } catch (error) {
      logger.error('Failed to create WebSocket connection:', error)
    }
  }

  const disconnect = () => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setIsConnected(false)
  }

  const send = (data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
      logger.debug('WebSocket message sent:', data)
    } else {
      logger.warn('WebSocket is not connected. Cannot send message.')
    }
  }

  useEffect(() => {
    connect()

    return () => {
      disconnect()
    }
  }, [])

  return {
    isConnected,
    lastMessage,
    send,
    disconnect,
  }
}
