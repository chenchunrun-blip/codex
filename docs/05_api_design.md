# API接口设计文档

**版本**: v1.0
**日期**: 2025-01-05
**API规范**: REST/OpenAPI 3.0

---

## 1. API概览

### 1.1 基础信息

```
Base URL: https://api.security-triage.com/v1
Protocol: HTTPS
Authentication: JWT Bearer Token
Content-Type: application/json
```

### 1.2 通用响应格式

**成功响应**:
```json
{
  "success": true,
  "data": {},
  "meta": {
    "timestamp": "2025-01-05T12:00:00Z",
    "request_id": "req_abc123"
  }
}
```

**错误响应**:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid request parameters",
    "details": {}
  },
  "meta": {
    "timestamp": "2025-01-05T12:00:00Z",
    "request_id": "req_abc123"
  }
}
```

### 1.3 HTTP状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 204 | 无内容 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 资源冲突 |
| 422 | 验证失败 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |
| 503 | 服务不可用 |

---

## 2. 告警管理API

### 2.1 提交告警

**POST** `/alerts`

**请求体**:
```json
{
  "alert_id": "ALT-2025-001",
  "timestamp": "2025-01-05T12:00:00Z",
  "alert_type": "malware",
  "source_ip": "45.33.32.156",
  "target_ip": "10.0.0.50",
  "severity": "high",
  "description": "Malware detected",
  "file_hash": "5e884898...",
  "asset_id": "ASSET-001",
  "user_id": "user@example.com",
  "raw_data": {}
}
```

**响应** (201):
```json
{
  "success": true,
  "data": {
    "ingestion_id": "ing_abc123",
    "alert_id": "ALT-2025-001",
    "status": "queued",
    "message": "Alert queued for processing"
  }
}
```

### 2.2 批量提交告警

**POST** `/alerts/batch`

**请求体**:
```json
{
  "alerts": [
    { /* alert object */ },
    { /* alert object */ }
  ]
}
```

**响应** (201):
```json
{
  "success": true,
  "data": {
    "count": 2,
    "ingestion_ids": ["ing_abc123", "ing_def456"]
  }
}
```

### 2.3 查询告警列表

**GET** `/alerts`

**查询参数**:
- `page`: 页码 (默认: 1)
- `page_size`: 每页数量 (默认: 20, 最大: 100)
- `status`: 状态筛选
- `severity`: 严重度筛选
- `risk_level`: 风险级别筛选
- `assigned_to`: 分配给
- `sort_by`: 排序字段 (默认: created_at)
- `sort_order`: 排序方向 (asc/desc)

**响应** (200):
```json
{
  "success": true,
  "data": {
    "total": 1000,
    "page": 1,
    "page_size": 20,
    "items": [
      {
        "id": "uuid",
        "alert_id": "ALT-2025-001",
        "status": "new",
        "severity": "high",
        "risk_score": 75.5,
        "created_at": "2025-01-05T12:00:00Z"
      }
    ]
  }
}
```

### 2.4 获取告警详情

**GET** `/alerts/{alert_id}`

**响应** (200):
```json
{
  "success": true,
  "data": {
    "alert": { /* 完整告警对象 */ },
    "triage_result": { /* 研判结果 */ },
    "context": {
      "network_context": {},
      "asset_context": {},
      "user_context": {}
    },
    "threat_intel": [],
    "similar_alerts": []
  }
}
```

### 2.5 更新告警状态

**PATCH** `/alerts/{alert_id}`

**请求体**:
```json
{
  "status": "in_progress",
  "assigned_to": "user@example.com",
  "comment": "开始调查"
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "alert_id": "ALT-2025-001",
    "status": "in_progress",
    "updated_at": "2025-01-05T12:05:00Z"
  }
}
```

### 2.6 添加评论

**POST** `/alerts/{alert_id}/comments`

**请求体**:
```json
{
  "content": "已确认是误报",
  "mentions": ["user@example.com"]
}
```

**响应** (201):
```json
{
  "success": true,
  "data": {
    "comment_id": "com_abc123",
    "content": "已确认是误报",
    "created_by": "user@example.com",
    "created_at": "2025-01-05T12:05:00Z"
  }
}
```

---

## 3. 威胁情报API

### 3.1 查询IOC

**GET** `/threat-intel/{ioc_type}/{ioc_value}`

**路径参数**:
- `ioc_type`: ip, domain, hash, url, email
- `ioc_value`: IOC值

**响应** (200):
```json
{
  "success": true,
  "data": {
    "ioc": "45.33.32.156",
    "ioc_type": "ip",
    "threat_level": "high",
    "threat_score": 7.5,
    "is_malicious": true,
    "sources": [
      {
        "name": "VirusTotal",
        "detection_rate": 45,
        "last_seen": "2025-01-04"
      }
    ],
    "tags": ["botnet", "c2"],
    "first_seen": "2024-12-01",
    "last_seen": "2025-01-04"
  }
}
```

### 3.2 批量查询IOC

**POST** `/threat-intel/batch`

**请求体**:
```json
{
  "iocs": [
    {"type": "ip", "value": "45.33.32.156"},
    {"type": "hash", "value": "5e884898..."}
  ]
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "results": [
      { /* ioc result */ },
      { /* ioc result */ }
    ]
  }
}
```

---

## 4. 工作流API

### 4.1 分配告警

**POST** `/alerts/{alert_id}/assign`

**请求体**:
```json
{
  "assigned_to": "user@example.com",
  "reason": "具备相关技能"
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "alert_id": "ALT-2025-001",
    "assigned_to": "user@example.com",
    "assigned_at": "2025-01-05T12:05:00Z",
    "assigned_by": "manager@example.com"
  }
}
```

### 4.2 升级告警

**POST** `/alerts/{alert_id}/escalate`

**请求体**:
```json
{
  "reason": "SLA即将超时",
  "escalate_to": "manager@example.com"
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "alert_id": "ALT-2025-001",
    "escalated_to": "manager@example.com",
    "escalated_at": "2025-01-05T12:05:00Z"
  }
}
```

---

## 5. 自动响应API

### 5.1 执行Playbook

**POST** `/automation/playbooks/{playbook_id}/execute`

**请求体**:
```json
{
  "alert_id": "ALT-2025-001",
  "parameters": {
    "ip": "45.33.32.156",
    "duration": "24h"
  },
  "dry_run": false
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "execution_id": "exec_abc123",
    "playbook_id": "block_ip",
    "status": "running",
    "started_at": "2025-01-05T12:05:00Z"
  }
}
```

### 5.2 查询执行状态

**GET** `/automation/executions/{execution_id}`

**响应** (200):
```json
{
  "success": true,
  "data": {
    "execution_id": "exec_abc123",
    "status": "completed",
    "result": {
      "success": true,
      "actions_performed": [
        "firewall_block",
        "siem_add_to_blacklist"
      ]
    },
    "started_at": "2025-01-05T12:05:00Z",
    "completed_at": "2025-01-05T12:05:10Z"
  }
}
```

---

## 6. 报表API

### 6.1 生成报表

**POST** `/reports`

**请求体**:
```json
{
  "report_type": "daily_summary",
  "date_range": {
    "start": "2025-01-01",
    "end": "2025-01-31"
  },
  "format": "pdf",
  "include_sections": [
    "overview",
    "top_alerts",
    "sla_compliance",
    "team_performance"
  ]
}
```

**响应** (201):
```json
{
  "success": true,
  "data": {
    "report_id": "rpt_abc123",
    "status": "generating",
    "estimated_completion": "2025-01-05T12:10:00Z"
  }
}
```

### 6.2 下载报表

**GET** `/reports/{report_id}/download`

**响应**: 文件流 (application/pdf)

---

## 7. 用户管理API

### 7.1 创建用户

**POST** `/users`

**请求体**:
```json
{
  "username": "john.doe",
  "email": "john.doe@example.com",
  "full_name": "John Doe",
  "role": "analyst",
  "department": "security",
  "skills": ["malware", "network"]
}
```

**响应** (201):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "username": "john.doe",
    "email": "john.doe@example.com",
    "role": "analyst",
    "created_at": "2025-01-05T12:00:00Z"
  }
}
```

### 7.2 获取用户列表

**GET** `/users`

**响应** (200):
```json
{
  "success": true,
  "data": {
    "total": 10,
    "items": [
      {
        "id": "uuid",
        "username": "john.doe",
        "email": "john.doe@example.com",
        "role": "analyst",
        "is_active": true
      }
    ]
  }
}
```

---

## 8. 系统配置API

### 8.1 获取配置

**GET** `/config`

**响应** (200):
```json
{
  "success": true,
  "data": {
    "risk_scoring": {
      "weights": {
        "severity": 0.3,
        "threat_intel": 0.3,
        "asset_criticality": 0.2,
        "exploitability": 0.2
      },
      "thresholds": {
        "critical": 90,
        "high": 70,
        "medium": 40,
        "low": 20
      }
    },
    "notifications": {
      "channels": ["email", "slack"],
      "routes": []
    }
  }
}
```

### 8.2 更新配置

**PATCH** `/config`

**请求体**:
```json
{
  "risk_scoring": {
    "weights": {
      "severity": 0.4
    }
  }
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "updated_at": "2025-01-05T12:00:00Z",
    "updated_by": "admin@example.com"
  }
}
```

---

## 9. 认证API

### 9.1 用户登录

**POST** `/auth/login`

**请求体**:
```json
{
  "username": "john.doe",
  "password": "password123",
  "mfa_code": "123456"
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGc...",
    "refresh_token": "eyJhbGc...",
    "token_type": "Bearer",
    "expires_in": 3600,
    "user": {
      "id": "uuid",
      "username": "john.doe",
      "role": "analyst"
    }
  }
}
```

### 9.2 刷新Token

**POST** `/auth/refresh`

**请求体**:
```json
{
  "refresh_token": "eyJhbGc..."
}
```

**响应** (200):
```json
{
  "success": true,
  "data": {
    "access_token": "eyJhbGc...",
    "expires_in": 3600
  }
}
```

---

## 10. 健康检查API

### 10.1 系统健康

**GET** `/health`

**响应** (200):
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2025-01-05T12:00:00Z",
  "components": {
    "api": "healthy",
    "database": "healthy",
    "redis": "healthy",
    "rabbitmq": "healthy",
    "chroma": "healthy"
  }
}
```

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
**OpenAPI文件**: `/docs/openapi.yaml`
