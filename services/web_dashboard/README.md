# Security Triage Dashboard - Web Frontend

React + TypeScript + Tailwind CSS 前端应用,为安全告警研判系统提供用户界面。

## 技术栈

- **框架**: React 18.3 + TypeScript 5.4
- **构建工具**: Vite 5.1
- **样式**: Tailwind CSS 3.4
- **路由**: React Router 6.22
- **状态管理**: Zustand 4.5
- **HTTP 客户端**: Axios 1.6
- **数据查询**: TanStack Query 5.28
- **图表**: Recharts 2.12
- **图标**: Lucide React 0.344

## 项目结构

```
services/web_dashboard/
├── src/
│   ├── components/       # 可复用组件
│   │   └── Layout.tsx    # 主布局组件
│   ├── contexts/         # React Context
│   │   └── AuthContext.tsx
│   ├── lib/              # 工具库
│   │   └── api.ts        # API 客户端
│   ├── pages/            # 页面组件
│   │   ├── Login.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Alerts.tsx
│   │   └── ...
│   ├── types/            # TypeScript 类型定义
│   │   └── index.ts
│   ├── App.tsx           # 主应用组件
│   ├── main.tsx          # 入口文件
│   └── index.css         # 全局样式
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── Dockerfile            # 多阶段构建 Dockerfile
```

## 快速开始

### 本地开发

```bash
# 进入前端目录
cd services/web_dashboard

# 安装依赖
npm install

# 启动开发服务器 (http://localhost:3000)
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

### Docker 构建

```bash
# 从项目根目录构建
docker-compose build web-dashboard

# 启动服务
docker-compose up -d web-dashboard

# 查看日志
docker-compose logs -f web-dashboard
```

### 环境变量

创建 `.env.local` 文件 (开发环境):

```bash
# API Base URL (Kong Gateway)
VITE_API_BASE_URL=http://localhost:8000

# WebSocket URL
VITE_WS_BASE_URL=ws://localhost:8000
```

## 主要功能

### ✅ 已实现

- [x] 用户认证和授权 (JWT)
- [x] 主仪表板 (告警指标、统计)
- [x] 告警列表 (搜索、过滤、分页)
- [x] 响应式布局 (移动端适配)
- [x] 主题样式 (Tailwind CSS)
- [x] 路由管理 (React Router)
- [x] API 客户端 (Axios + React Query)

### 🚧 待实现

- [ ] 告警详情页面
- [ ] 报表生成和下载
- [ ] 配置管理界面
- [ ] 实时更新 (WebSocket)
- [ ] 告警手动创建
- [ ] 告警状态更新
- [ ] 工作流可视化
- [ ] 通知中心
- [ ] 暗色主题
- [ ] 多语言支持

## API 集成

前端通过 Kong Gateway 与后端 API 通信:

```typescript
// API 基础路径
const API_BASE_URL = `${VITE_API_BASE_URL}/api/v1`

// 主要 API 端点
GET    /api/v1/alerts              # 获取告警列表
GET    /api/v1/alerts/:id          # 获取告警详情
POST   /api/v1/alerts              # 创建告警
PATCH  /api/v1/alerts/:id/status   # 更新告警状态

GET    /api/v1/metrics             # 获取指标
GET    /api/v1/trends              # 获取趋势

GET    /api/v1/reports             # 获取报表列表
POST   /api/v1/reports             # 创建报表

GET    /api/v1/config              # 获取配置
PUT    /api/v1/config/:key         # 更新配置
```

## 开发指南

### 添加新页面

1. 在 `src/pages/` 创建页面组件:

```typescript
// src/pages/NewPage.tsx
import React from 'react'

export const NewPage: React.FC = () => {
  return (
    <div>
      <h1>New Page</h1>
    </div>
  )
}
```

2. 在 `src/App.tsx` 添加路由:

```typescript
<Route path="new-page" element={<NewPage />} />
```

3. 在 `src/components/Layout.tsx` 添加导航链接:

```typescript
{ name: 'New Page', href: '/new-page', icon: IconComponent }
```

### API 调用示例

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const MyComponent: React.FC = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.alerts.getAlerts(),
  })

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error loading alerts</div>

  return <div>{JSON.stringify(data)}</div>
}
```

### 样式指南

使用 Tailwind CSS 工具类:

```tsx
// 布局
<div className="flex items-center justify-between gap-4 p-6">

// 颜色
<div className="bg-primary-500 text-white">

// 文字
<h1 className="text-2xl font-bold text-gray-900">

// 按钮
<button className="btn btn-primary">Click me</button>

// 卡片
<div className="card">
  <div className="card-header">Header</div>
  <div className="card-body">Content</div>
</div>
```

## 测试

```bash
# 运行测试 (待配置)
npm test

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 格式化代码
npm run format
```

## 部署

### Docker Compose (推荐)

```bash
docker-compose up -d web-dashboard
```

### 手动部署

```bash
# 1. 构建前端
npm run build

# 2. 构建镜像
docker build -t security-triage-dashboard .

# 3. 运行容器
docker run -p 9015:8000 security-triage-dashboard
```

## 访问

- **开发环境**: http://localhost:3000
- **生产环境** (直接访问): http://localhost:9015
- **生产环境** (通过 Kong): http://localhost:8000

## 默认凭证

```
Username: admin
Password: admin123
```

## 故障排除

### 构建失败

```bash
# 清除缓存并重新安装
rm -rf node_modules package-lock.json
npm install
```

### API 连接失败

检查 `.env.local` 中的 `VITE_API_BASE_URL` 是否正确。

### Docker 构建慢

多阶段构建可能需要较长时间,首次构建会下载 Node.js 和 Python 依赖。

## 性能优化

- 代码分割 (React.lazy + Suspense)
- 图表懒加载
- API 响应缓存 (React Query)
- 图片优化 (待实现)
- Service Worker (待实现)

## 许可证

Apache 2.0

---

**作者**: CCR <chenchunrun@gmail.com>
**最后更新**: 2026-01-06
