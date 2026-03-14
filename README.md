# MarqDex - AI-Powered Collaborative Workspace

A modern platform for teams to collaborate on documents in real-time, enhanced by intelligent AI assistance and professional templates.

**Original Author**: [chenchunrun](https://github.com/chenchunrun)

## 🎯 Project Status: Active Development (Core Flows Available)

### ✅ Completed Features

#### Backend Architecture (100%)
- ✅ Complete Prisma database schema (12 models)
- ✅ NextAuth.js v5 authentication system with email verification
- ✅ Role-based access control (RBAC)
- ✅ Complete API modules (auth, teams, projects, files, templates, versions, comments, notifications, activity logs)
- ✅ Email notification system with multiple SMTP providers
- ✅ Comment threading with nested replies (3 levels deep)
- ✅ Unread notification count endpoint

#### Frontend Interface (100%)
- ✅ User authentication pages (login/register with email verification)
- ✅ Responsive dashboard with statistics
- ✅ Team management (list + create + member management)
- ✅ Project management (list + create + member management)
- ✅ Template center (browse + copy)
- ✅ File management (list, search, size display, version count)
- ✅ Markdown editor with real-time preview
- ✅ Responsive Settings page
- ✅ Email verification and preferences UI
- ✅ Comment panel with @mentions and threading
- ✅ Notification center with real-time updates

#### Integration Features
- ✅ Liveblocks real-time collaboration foundation
- ✅ OpenAI-compatible AI client
- ✅ Version control system with history
- ✅ Comment system with threading and resolution
- ✅ Email notifications (team invites, project invites, mentions, file updates, project updates)
- ✅ Human + agent task assignment model (human, direct agent, and agent queue)
- ✅ Markdown-first task specification and deliverable review loop
- ✅ Operations status/health panels and report export/save hub

---

## 🚀 Quick Start

### Prerequisites

1. **Node.js** 18+
2. **PostgreSQL database** (Docker or cloud-hosted)
3. **Liveblocks account** (for real-time collaboration)
4. **OpenAI API key** (optional, for AI features)
5. **SMTP account** (optional, for email notifications)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/chenchunrun/marqdex.git
cd marqdex

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env file with your configuration

# 4. Start PostgreSQL database
docker run -d \
  --name marqdex-db \
  -e POSTGRES_USER=markdown_user \
  -e POSTGRES_PASSWORD=markdown_password_123 \
  -e POSTGRES_DB=markdown_collab \
  -p 5432:5432 \
  postgres:16-alpine

# 5. Generate Prisma client
npm run db:generate

# 6. Run database migrations
npm run db:migrate

# 7. Import built-in templates
npm run db:seed

# 8. Start development server
npm run dev
```

Visit http://localhost:3000

---

## 📝 Environment Variables

Create a `.env` file in the project root:

```env
# Database Configuration
DATABASE_URL="postgresql://markdown_user:markdown_password_123@localhost:5432/markdown_collab?schema=public"

# NextAuth Configuration
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="generate-with-openssl-rand-base64-32"

# Liveblocks (optional - for real-time collaboration)
# LIVEBLOCKS_SECRET="your-liveblocks-secret"
# LIVEBLOCKS_PUBLIC_KEY="your-liveblocks-public-key"

# Encryption (for API keys)
ENCRYPTION_KEY="32-character-encryption-key-here-change"

# Email Service (optional - for notifications)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your-email@gmail.com"
SMTP_PASS="your-app-password"
SMTP_FROM="MarqDex <your-email@gmail.com>"

# App Configuration
APP_NAME="MarqDex"
APP_URL="http://localhost:3000"

# Node Environment
NODE_ENV="development"
```

---

## 🛠️ Tech Stack

| Layer | Technology | Description |
|-------|-----------|-------------|
| Framework | Next.js 16 | App Router, SSR/SSG, Turbopack |
| Language | TypeScript | Type safety |
| Database | PostgreSQL | Relational database |
| ORM | Prisma | Type-safe database access |
| Authentication | NextAuth.js v5 | JWT session management |
| Real-time | Liveblocks | Multi-user sync editing |
| Email | Nodemailer | SMTP email sending |
| Styling | Tailwind CSS | Utility-first CSS |
| AI | OpenAI API | Content generation |

---

## 📂 Project Structure

```
marqdex/
├── app/                          # Next.js app directory
│   ├── (auth)/                   # Auth pages (login, register)
│   ├── api/                      # API routes
│   │   ├── auth/                # Authentication endpoints
│   │   ├── teams/               # Team management
│   │   ├── projects/            # Project management
│   │   ├── files/               # File operations
│   │   ├── templates/           # Template management
│   │   ├── comments/            # Comment system
│   │   ├── notifications/       # Notification system
│   │   └── ai/                  # AI integration
│   ├── dashboard/               # Dashboard page
│   ├── teams/                   # Team pages
│   ├── projects/                # Project pages
│   ├── templates/               # Template center
│   ├── files/                   # File management
│   ├── editor/                  # Markdown editor
│   └── settings/                # Settings page
├── components/                   # React components
│   ├── auth/                    # Auth components
│   ├── dashboard/               # Dashboard components
│   ├── settings/                # Settings components
│   ├── comments/                # Comment components
│   ├── notifications/           # Notification components
│   └── ui/                      # UI components
├── lib/                         # Utility libraries
│   ├── auth/                    # Auth logic
│   ├── email/                   # Email service
│   ├── ai/                      # AI integration
│   ├── liveblocks/              # Real-time config
│   ├── utils/                   # Helper functions
│   └── db.ts                    # Database client
├── prisma/                      # Prisma configuration
│   ├── schema.prisma            # Database schema
│   └── seed.ts                  # Seed data
├── docs/                        # Documentation
│   └── architecture/            # Architecture docs
└── public/                      # Static assets
```

---

## 🎯 Core Features

### 1. User Authentication
- Email/password registration and login
- Email verification system
- JWT session management
- Secure password hashing (bcrypt)

### 2. Team Collaboration
- Create/manage teams
- Add/remove team members
- Role-based permissions (admin/member)

### 3. Project Management
- Create/manage projects
- Project member management
- File organization within projects
- Project-level operations status visibility for queue/dispatch/run/report health

### 4. Template System
- Rich built-in English templates for PM + IT delivery, including:
  - 🎯 Problem Definition / Project Charter / PRD
  - 💡 Solution Design / TDD / API Spec / ADR / Data Migration Plan / Runbook
  - 📊 Execution Tracking / Sprint Plan / Release Checklist / Change Request / Risk Register / Stakeholder Communication Plan
  - 📝 Retrospective Summary / Incident Postmortem
- Custom template support
- One-click copy to use

### 5. File Editing
- Real-time Markdown editing
- Split-screen preview
- Toolbar with formatting options
- Auto-save every 30 seconds
- Export to .md/.pdf
- Version control with history

### 6. AI Integration
- OpenAI-compatible API
- Template-specific AI prompts
- One-click content generation

### 7. Comments & Mentions
- Threaded comments (3 levels deep)
- @mention notifications
- Comment resolution/reopen
- Real-time comment updates

### 8. Email Notifications
- Team invitations
- Project invitations
- @mention notifications
- File updates
- Project updates
- Email preferences management
- Support for multiple SMTP providers (Gmail, 163, QQ, Outlook)

### 9. Notifications
- Real-time notification center
- Unread count badge
- Activity log tracking
- Mark as read/unread

### 10. Human-Agent Operations Status
- Unified operations status API and panel for:
  - Agent queue backlog
  - Scheduler dispatch batches (started/completed/failed)
  - Agent run triggered/failed metrics
  - Saved report throughput by type
- Markdown export and save-to-project report flow

### 11. Human-Agent Task Orchestration
- Markdown-first TaskSpec workflow for task creation and handoff
- Intelligent assignee suggestions and agent queue dispatch
- Human claim + agent execution collaboration loop
- Deliverable submit/review/approve/reject with requeue support

---

## 📖 Usage Guide

### Quick Start Flow

1. **Register Account**
   ```
   Visit homepage → Click "Create Account" → Fill info → Verify email
   ```

2. **Create Team**
   ```
   Go to Dashboard → Click "Create Team" → Enter team info → Create
   ```

3. **Create Project**
   ```
   Go to "Teams" → Select team → Click "Create Project" → Enter project info
   ```

4. **Create File**
   ```
   Method 1: Go to "Templates" → Select template → Copy content
   Method 2: Create blank file directly in project
   ```

5. **Edit & Collaborate**
   ```
   Go to "Files" → Select file → Use toolbar to edit → Real-time preview → Auto-save
   ```

6. **Add Comments**
   ```
   Open file → Click comment icon → Write comment → @mention teammates → Submit
   ```

---

## 🔧 Development

### Available Scripts

```bash
npm run dev             # Start development server
npm run build           # Build for production
npm run start           # Start production server
npm run typecheck       # TypeScript type check
npm run lint            # Run ESLint
npm run test            # Jest test suite
npm run test:unit:core  # Core unit/regression suite
npm run test:e2e:smoke  # E2E smoke suite (auth + operations)
npm run test:e2e:workspace # E2E workspace core flows (files/templates/team)
npm run test:e2e:team   # E2E team rollout flows (starter pack + template quick use)
npm run test:e2e:team-members # E2E team-members resilience flow (search retry + add)
npm run test:e2e:queue  # E2E agent queue console flow (domain switch + claim payload)
npm run test:e2e:ops    # E2E task operations retry flow (retryable failed task filtering)
npm run test:e2e:onboarding # E2E no-project onboarding states for files/reports
npm run test:e2e:review # E2E review queue priority flow (status normalization + default sort + summary)
npm run verify:core     # One-command core quality gate
npm run verify:mainline # One-command mainline flow gate (review + workspace + team + collab core)
npm run verify:extended # Extended gate (core + workspace/team + review queue + collab core flow)
npm run db:generate     # Generate Prisma client
npm run db:migrate      # Run database migrations
npm run db:seed         # Import seed data
```

### Mainline Regression Order

Use this sequence before merging workflow-related changes:

```bash
# 1) Mainline one-command gate
npm run verify:mainline

# 2) Full extended gate
npm run verify:extended
```

Release readiness checklist: [`docs/release-checklist.md`](./docs/release-checklist.md)

### Database Models

- User, Account, Session - Authentication
- Team, TeamMember - Team management
- Project, ProjectMember - Project management
- File, FileVersion - Files and versions
- Comment, Mention - Comments and mentions
- Template - Template system
- Notification - Notification system
- ActivityLog - Activity tracking

See `prisma/schema.prisma` for complete schema.

---

## 🚀 Deployment

### Production Build

```bash
# 1. Build the application
npm run build

# 2. Generate Prisma client
npm run db:generate

# 3. Set production environment variables
# Copy your .env file to the server

# 4. Run database migrations
npx prisma migrate deploy

# 5. Start the production server
npm start
```

### Docker Deployment

```bash
# 1. Build Docker image
docker build -t marqdex .

# 2. Run with Docker Compose
docker-compose up -d

# 3. Run database migrations
docker-compose exec app npx prisma migrate deploy
```

### Vercel Deployment

```bash
# 1. Install Vercel CLI
npm i -g vercel

# 2. Deploy to Vercel
vercel

# 3. Set environment variables in Vercel dashboard
```

For detailed deployment instructions, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

## 📋 API Endpoints

### Authentication
```
POST /api/auth/register              # User registration
POST /api/auth/signin                # User login
GET  /api/auth/session               # Get session
POST /api/auth/signout               # User logout
POST /api/auth/send-verification-email  # Send verification email
GET  /api/auth/verify-email          # Verify email
```

### Teams
```
GET    /api/teams                    # Get teams list
POST   /api/teams                    # Create team
GET    /api/teams/[id]               # Get team details
PATCH  /api/teams/[id]               # Update team
DELETE /api/teams/[id]               # Delete team
GET    /api/teams/[id]/members       # Get team members
POST   /api/teams/[id]/members       # Add team member
DELETE /api/teams/[id]/members/[id]  # Remove team member
```

### Projects
```
GET    /api/projects                 # Get projects list
POST   /api/projects                 # Create project
GET    /api/projects/[id]            # Get project details
PATCH  /api/projects/[id]            # Update project
DELETE /api/projects/[id]            # Delete project
GET    /api/projects/[id]/members    # Get project members
POST   /api/projects/[id]/members    # Add project member
DELETE /api/projects/[id]/members/[id]  # Remove project member
```

### Files
```
GET    /api/files                    # Get files list
POST   /api/files                    # Create file
GET    /api/files/[id]               # Get file details
PATCH  /api/files/[id]               # Update file
DELETE /api/files/[id]               # Delete file
GET    /api/files/[id]/versions      # Get file versions
```

### Comments
```
GET    /api/comments                 # Get comments
POST   /api/comments                 # Create comment
PATCH  /api/comments/[id]            # Update comment
DELETE /api/comments/[id]            # Delete comment
```

### Notifications
```
GET    /api/notifications            # Get notifications
PATCH  /api/notifications/[id]       # Mark as read
GET    /api/notifications/unread-count  # Get unread count
```

---

## 🔐 Security

- ✅ Password hashing with bcrypt
- ✅ JWT session management
- ✅ Role-based access control
- ✅ Protected API routes
- ✅ SQL injection prevention (Prisma)
- ✅ XSS protection
- ✅ Email verification
- ✅ Environment variable protection

---

## 📚 Documentation

- [Architecture Documentation](./docs/architecture/README.md)
- [Email Features Guide](./docs/email-features.md)
- [Email Service Setup](./docs/email-service-setup.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)

---

## 🤝 Contributing

We welcome contributions! Please feel free to submit issues and pull requests.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add some amazing feature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](./LICENSE) file for details.

---

## 🆘 Support

For support, please open an issue in the GitHub repository or check the documentation.

---

**Project Status**: ✅ Production Ready
**Last Updated**: 2025-01-29
**Version**: 1.0.0
