# MarqDex Work System - System Architecture

## High-Level System Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        Browser[Web Browser]
        Desktop[Desktop App]
    end

    subgraph "Frontend Layer (Next.js 16)"
        AppRouter[App Router]
        Pages[Pages]
        Components[React Components]
        State[State Management<br/>Zustand]
    end

    subgraph "API Layer (Next.js API Routes)"
        AuthAPI[Authentication API]
        TeamAPI[Team API]
        ProjectAPI[Project API]
        FileAPI[File API]
        CommentAPI[Comment API]
        NotificationAPI[Notification API]
        AIAPI[AI Generation API]
    end

    subgraph "Business Logic Layer"
        RBAC[Role-Based Access Control]
        NotificationService[Notification Service]
        ActivityLogService[Activity Log Service]
        FileVersionService[File Version Service]
        AIService[AI Content Service]
    end

    subgraph "Real-time Layer"
        Liveblocks[Liveblocks<br/>Collaboration Engine]
        WebSocket[WebSocket Connection]
    end

    subgraph "Data Layer"
        Prisma[Prisma ORM]
        PostgreSQL[(PostgreSQL<br/>Database)]
        SessionStore[Session Store]
    end

    subgraph "External Services"
        OpenAI[OpenAI API]
        Email[Email Service]
    end

    Browser --> AppRouter
    Desktop --> AppRouter
    AppRouter --> Pages
    AppRouter --> Components
    Components --> State

    Pages --> AuthAPI
    Pages --> TeamAPI
    Pages --> ProjectAPI
    Pages --> FileAPI
    Pages --> CommentAPI
    Pages --> NotificationAPI
    Pages --> AIAPI

    AuthAPI --> RBAC
    TeamAPI --> RBAC
    ProjectAPI --> RBAC
    FileAPI --> RBAC
    CommentAPI --> RBAC

    TeamAPI --> NotificationService
    ProjectAPI --> NotificationService
    FileAPI --> NotificationService
    CommentAPI --> NotificationService

    FileAPI --> FileVersionService

    FileAPI --> ActivityLogService
    ProjectAPI --> ActivityLogService
    TeamAPI --> ActivityLogService

    AIAPI --> AIService
    AIService --> OpenAI

    FileAPI --> Liveblocks
    Liveblocks --> WebSocket

    RBAC --> Prisma
    NotificationService --> Prisma
    ActivityLogService --> Prisma
    FileVersionService --> Prisma
    AuthAPI --> Prisma

    Prisma --> PostgreSQL
    AuthAPI --> SessionStore

    NotificationService --> Email

    style Browser fill:#e1f5ff
    style PostgreSQL fill:#f5f5f5
    style Liveblocks fill:#fff4e1
    style RBAC fill:#ffe1e1
```

## Layer Architecture

```mermaid
graph LR
    subgraph "Presentation Layer"
        A1[Pages]
        A2[Components]
        A3[UI Kit<br/>Radix UI + Tailwind]
    end

    subgraph "Application Layer"
        B1[API Routes]
        B2[Server Actions]
        B3[Middleware]
    end

    subgraph "Domain Layer"
        C1[Business Logic]
        C2[Validation]
        C3[Authorization]
    end

    subgraph "Infrastructure Layer"
        D1[Database<br/>Prisma + PostgreSQL]
        D2[Real-time<br/>Liveblocks]
        D3[External APIs<br/>OpenAI, Email]
        D4[Authentication<br/>NextAuth.js]
    end

    A1 --> B1
    A2 --> B1
    A3 --> A2

    B1 --> C1
    B2 --> C1
    B3 --> C2

    C1 --> D1
    C1 --> D2
    C1 --> D3
    C3 --> D4

    style A1 fill:#e3f2fd
    style B1 fill:#fff3e0
    style C1 fill:#f3e5f5
    style D1 fill:#e8f5e9
```

## Technology Stack

### Frontend
- **Framework**: Next.js 16 with App Router
- **UI Components**: Radix UI (accessible primitives)
- **Styling**: Tailwind CSS (utility-first)
- **State Management**: Zustand (client state)
- **Real-time Collaboration**: Liveblocks
- **Markdown**: react-markdown, marked, rehype plugins
- **Icons**: Lucide React

### Backend
- **Runtime**: Node.js
- **API**: Next.js API Routes
- **ORM**: Prisma
- **Database**: PostgreSQL
- **Authentication**: NextAuth.js v5
- **Password Hashing**: bcryptjs
- **Validation**: Zod

### External Services
- **AI**: OpenAI API (user-provided keys)
- **Email**: Nodemailer
- **Real-time**: Liveblocks

## Key Features & Components

### 1. Authentication System
- JWT-based authentication with NextAuth.js
- Secure password hashing with bcrypt
- Session management
- Email verification support

### 2. Authorization System (RBAC)
- **Team Roles**: ADMIN, MEMBER
- **Project Roles**: ADMIN, EDITOR, VIEWER
- Resource-level access control
- Permission checks on all API endpoints

### 3. Team Management
- Create and manage teams
- Add/remove team members
- Team member role management
- Team activity tracking

### 4. Project Management
- Projects within teams
- Project member management
- Project status tracking
- Activity logging

### 5. File Management
- Markdown file creation and editing
- File versioning and history
- Auto-save functionality
- File templates
- Import from Word documents

### 6. Real-time Collaboration
- Liveblocks integration
- Multi-user editing
- Presence indicators
- Conflict resolution

### 7. Comment System
- Inline comments
- @mentions
- Comment threading
- Real-time notifications

### 8. Notification System
- Real-time notifications
- Multiple notification types
- Notification center UI
- Mark as read functionality

### 9. Activity Logging
- Comprehensive audit trail
- Action tracking
- User activity history

### 10. AI Integration
- User-provided OpenAI API keys
- Template-based content generation
- AI-powered content enhancement
- Custom AI endpoint support

## Deployment Architecture

```mermaid
graph TB
    subgraph "Development"
        Dev[Dev Server<br/>localhost:3002]
    end

    subgraph "Production (Recommended)"
        subgraph "Frontend"
            Vercel[Vercel Deployment<br/>Next.js optimized]
        end

        subgraph "Backend"
            API[API Server<br/>Node.js]
        end

        subgraph "Database"
            RDS[(Amazon RDS<br/>PostgreSQL)]
            Supabase[(Supabase<br/>PostgreSQL)]
        end

        subgraph "Real-time"
            LiveblocksCloud[Liveblocks Cloud]
        end
    end

    Dev --> Production

    Vercel --> API
    API --> RDS
    API --> Supabase
    API --> LiveblocksCloud

    style Vercel fill:#ffffff
    style RDS fill:#f5f5f5
    style LiveblocksCloud fill:#fff4e1
```

## Security Architecture

```mermaid
graph TB
    subgraph "Authentication"
        A1[NextAuth.js]
        A2[JWT Tokens]
        A3[bcrypt Password Hashing]
    end

    subgraph "Authorization"
        B1[RBAC Engine]
        B2[Permission Checks]
        B3[Resource Access Control]
    end

    subgraph "Data Protection"
        C1[SQL Injection Prevention<br/>Prisma ORM]
        C2[XSS Protection<br/>React Sanitization]
        C3[API Key Encryption]
        C4[HTTPS Only]
    end

    subgraph "Session Management"
        D1[Secure Cookies]
        D2[Session Expiration]
        D3[Token Refresh]
    end

    A1 --> B1
    A2 --> B1
    A3 --> A1

    B1 --> B2
    B2 --> B3

    B3 --> C1
    B3 --> C2
    B3 --> C3

    A2 --> D1
    D1 --> D2
    D2 --> D3

    style A1 fill:#e3f2fd
    style B1 fill:#fff3e0
    style C1 fill:#f3e5f5
    style D1 fill:#e8f5e9
```

## Performance Optimizations

1. **Frontend**
   - Code splitting with Next.js App Router
   - Lazy loading for components
   - Image optimization
   - Debounced auto-save

2. **Backend**
   - Database connection pooling
   - Efficient Prisma queries
   - Database indexing
   - Response caching

3. **Real-time**
   - WebSocket connection pooling
   - Optimistic updates
   - Conflict resolution

4. **Database**
   - Proper indexing on foreign keys
   - Query optimization
   - Connection pooling
   - Read replicas (future)
