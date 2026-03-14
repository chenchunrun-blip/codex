"use client"

import { useState, useEffect } from "react"
import { MessageSquare, Reply } from "lucide-react"
import { mapReportApiErrorFromPayload } from "@/lib/reports/api-error"

interface Comment {
  id: string
  content: string
  createdAt: string
  isResolved: boolean
  parentId: string | null
  author: {
    id: string
    name: string | null
    email: string
  }
  replies?: Comment[]
}

interface CommentsPanelProps {
  fileId: string
  projectId?: string
  currentUserId?: string
}

// Helper function to organize comments into threads
function organizeComments(comments: Comment[]): Comment[] {
  const commentMap = new Map<string, Comment>()
  const rootComments: Comment[] = []

  // First pass: create map and initialize replies array
  comments.forEach(comment => {
    commentMap.set(comment.id, { ...comment, replies: [] })
  })

  // Second pass: build tree structure
  comments.forEach(comment => {
    const mappedComment = commentMap.get(comment.id)!
    if (comment.parentId) {
      const parent = commentMap.get(comment.parentId)
      if (parent) {
        parent.replies!.push(mappedComment)
      } else {
        // Parent not found, treat as root comment
        rootComments.push(mappedComment)
      }
    } else {
      rootComments.push(mappedComment)
    }
  })

  return rootComments
}

// Recursive component to render comment and its replies
function CommentItem({
  comment,
  fileId,
  onToggleResolve,
  onReply,
  replyTo,
  setReplyTo,
  replyContent,
  setReplyContent,
  isSubmitting,
  depth = 0
}: {
  comment: Comment
  fileId: string
  onToggleResolve: (id: string, state: boolean) => void
  onReply: (e: React.FormEvent, parentId: string) => void
  replyTo: string | null
  setReplyTo: (id: string | null) => void
  replyContent: string
  setReplyContent: (content: string) => void
  isSubmitting: boolean
  depth?: number
}) {
  const isReplying = replyTo === comment.id
  const maxDepth = 3 // Maximum nesting depth
  const canReply = depth < maxDepth

  return (
    <div className={`${depth > 0 ? 'ml-8 mt-3' : ''}`}>
      <div
        className={`p-4 rounded-lg border ${
          comment.isResolved
            ? "bg-green-50 border-green-200"
            : "bg-gray-50 border-gray-200"
        }`}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
              {(comment.author.name || comment.author.email || "U").charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">
                {comment.author.name || comment.author.email}
              </div>
              <div className="text-xs text-gray-500">
                {new Date(comment.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canReply && (
              <button
                onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                className="text-xs text-gray-600 hover:text-gray-900 font-medium flex items-center gap-1"
              >
                <Reply size={14} />
                Reply
              </button>
            )}
            <button
              onClick={() => onToggleResolve(comment.id, comment.isResolved)}
              className={`text-xs font-medium ${
                comment.isResolved
                  ? "text-gray-600 hover:text-gray-700"
                  : "text-green-600 hover:text-green-700"
              }`}
            >
              {comment.isResolved ? "Reopen" : "Resolve"}
            </button>
          </div>
        </div>

        <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.content}</p>

        {comment.isResolved && (
          <div className="mt-2 text-xs text-green-600 font-medium">
            ✓ Resolved
          </div>
        )}

        {/* Reply Form */}
        {isReplying && (
          <form onSubmit={(e) => onReply(e, comment.id)} className="mt-3 space-y-2">
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              placeholder="Write your reply..."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
              rows={2}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isSubmitting || !replyContent.trim()}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Sending..." : "Send Reply"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setReplyTo(null)
                  setReplyContent("")
                }}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Render Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-2 space-y-2">
          {comment.replies.map(reply => (
            <CommentItem
              key={reply.id}
              comment={reply}
              fileId={fileId}
              onToggleResolve={onToggleResolve}
              onReply={onReply}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              replyContent={replyContent}
              setReplyContent={setReplyContent}
              isSubmitting={isSubmitting}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function CommentsPanel({ fileId }: CommentsPanelProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [organizedComments, setOrganizedComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newComment, setNewComment] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchComments()
  }, [fileId])

  const fetchComments = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/comments?fileId=${fileId}`)
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to fetch comments"))
      }
      const data = await response.json()
      setComments(data)
      setOrganizedComments(organizeComments(data))
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to fetch comments")
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComment.trim()) return

    setIsSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          content: newComment
        })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to submit comment"))
      }
      setNewComment("")
      fetchComments()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to submit comment")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleToggleResolve = async (commentId: string, currentState: boolean) => {
    setError(null)
    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isResolved: !currentState })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to update comment"))
      }
      fetchComments()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update comment")
    }
  }

  const handleReply = async (e: React.FormEvent, parentId: string) => {
    e.preventDefault()
    if (!replyContent.trim()) return

    setIsSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId,
          content: replyContent,
          parentId
        })
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(mapReportApiErrorFromPayload(payload, "Failed to submit reply"))
      }
      setReplyContent("")
      setReplyTo(null)
      fetchComments()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to submit reply")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Comments</h2>
        <p className="text-sm text-gray-500">{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</p>
      </div>

      {/* Comments List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded">
            <div>{error}</div>
            <button
              onClick={fetchComments}
              className="mt-2 text-xs text-red-700 underline"
            >
              Retry
            </button>
          </div>
        )}
        {isLoading ? (
          <div className="text-center text-gray-500 py-8">Loading comments...</div>
        ) : comments.length === 0 ? (
          <div className="text-center text-gray-500 py-8 flex flex-col items-center">
            <MessageSquare className="w-12 h-12 mb-3 text-gray-300" />
            <p>No comments yet. Be the first to comment!</p>
          </div>
        ) : (
          organizedComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              fileId={fileId}
              onToggleResolve={handleToggleResolve}
              onReply={handleReply}
              replyTo={replyTo}
              setReplyTo={setReplyTo}
              replyContent={replyContent}
              setReplyContent={setReplyContent}
              isSubmitting={isSubmitting}
            />
          ))
        )}
      </div>

      {/* New Comment Form */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          placeholder="Add a comment... (Use @ to mention someone)"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={3}
          disabled={isSubmitting}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting || !newComment.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Sending..." : "Send Comment"}
          </button>
        </div>
      </form>
    </div>
  )
}
