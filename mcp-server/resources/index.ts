/**
 * Resource exports for MCP Server
 */

export * from './project'

// Re-export with type-only exports for shared types
export type { ResourceHandlerContext } from './file'
export * from './file'

export type { ResourceHandlerContext as TaskResourceHandlerContext } from './task'
export * from './task'
