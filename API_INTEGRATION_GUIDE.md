# API 对接指南 - Alert Ingestor Service

**文档版本**: 1.0
**API 版本**: v1
**基础 URL**: `http://localhost:8001`
**最后更新**: 2026-01-06
**维护者**: CCR <chenchunrun@gmail.com>

---

## 📋 概述

Alert Ingestor Service 提供统一的 RESTful API 用于接入来自各种来源的安全告警。本文档详细说明了如何对接该服务，包括 API 接口、数据格式、错误处理和集成示例。

### 支持的告警来源

- **SIEM 系统**: Splunk, QRadar, LogRhythm, Elastic SIEM
- **IDS/IPS**: Snort, Suricata, Zeek (Bro)
- **EDR 系统**: CrowdStrike, Carbon Black, SentinelOne
- **防火墙**: Palo Alto, Cisco ASA, Fortinet
- **Web 应用防火墙**: ModSecurity, AWS WAF, Cloudflare
- **自定义系统**: 任何支持 HTTP POST 的系统

### API 特性

- ✅ RESTful 设计
- ✅ JSON 数据格式
- ✅ 速率限制（100 req/min per IP）
- ✅ 批量接入（最多 100 个告警）
- ✅ 异步处理
- ✅ 消息队列集成

---

## 🔌 API 端点总览

| 端点 | 方法 | 描述 | 认证 | 速率限制 |
|------|------|------|------|----------|
| `/api/v1/alerts` | POST | 接入单个告警 | 可选 | 100 req/min |
| `/api/v1/alerts/batch` | POST | 批量接入告警 | 可选 | 100 req/min |
| `/api/v1/alerts/{alert_id}` | GET | 查询告警状态 | 可选 | 无限制 |
| `/health` | GET | 健康检查 | 无 | 无限制 |
| `/metrics` | GET | 服务指标 | 无 | 无限制 |

---

## 📝 API 详细说明

### 1. 接入单个告警

#### 端点
```
POST /api/v1/alerts
```

#### 请求头
```http
Content-Type: application/json
Authorization: Bearer <optional_jwt_token>  # 如果启用了认证
X-Correlation-ID: <optional_correlation_id>  # 用于追踪
```

#### 请求体 (SecurityAlert)

```json
{
  "alert_id": "string (required)",           // 告警唯一标识
  "timestamp": "string (ISO 8601)",          // 告警时间戳
  "alert_type": "enum (required)",           // 告警类型（见下方枚举）
  "severity": "enum (required)",             // 严重级别（见下方枚举）
  "description": "string (required)",        // 告警描述
  "source_ip": "string (IPv4)",              // 源 IP 地址
  "target_ip": "string (IPv4)",              // 目标 IP 地址
  "file_hash": "string (MD5/SHA1/SHA256)",   // 文件哈希
  "url": "string (URL)",                     // 相关 URL
  "asset_id": "string",                      // 资产标识
  "user_id": "string",                       // 用户标识
  "raw_data": "object (optional)"            // 原始数据（自动附加）
}
```

#### 告警类型 (AlertType)

| 值 | 描述 | 典型场景 |
|----|------|----------|
| `malware` | 恶意软件 | EDR 检测到病毒、木马、勒索软件 |
| `phishing` | 网络钓鱼 | 邮件网关检测到钓鱼邮件 |
| `brute_force` | 暴力破解 | SSH/RDP 多次登录失败 |
| `ddos` | DDoS 攻击 | 流量异常激增 |
| `data_exfiltration` | 数据泄露 | 大量数据传输到外部 |
| `unauthorized_access` | 未授权访问 | 非工作时间登录 |
| `policy_violation` | 策略违规 | 违反安全策略 |
| `anomaly` | 异常行为 | 行为基线偏离 |
| `vulnerability` | 漏洞利用 | 检测到漏洞利用尝试 |
| `intrusion` | 入侵检测 | IDS/IPS 检测到攻击 |
| `other` | 其他 | 未分类告警 |

#### 严重级别 (Severity)

| 值 | 描述 | 响应时间要求 |
|----|------|-------------|
| `critical` | 严重 | 立即（< 15 分钟） |
| `high` | 高 | 1 小时内 |
| `medium` | 中 | 4 小时内 |
| `low` | 低 | 24 小时内 |
| `info` | 信息 | 无需立即响应 |

#### 成功响应 (200 OK)

```json
{
  "success": true,
  "data": {
    "ingestion_id": "550e8400-e29b-41d4-a716-446655440000",
    "alert_id": "alert-2026-001",
    "status": "queued",
    "message": "Alert queued for processing"
  },
  "meta": {
    "timestamp": "2026-01-06T10:00:00.000000",
    "request_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

#### 错误响应

**400 Bad Request** - 验证失败
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation error: alert_id is required",
    "details": {
      "field": "alert_id",
      "constraint": "required"
    }
  }
}
```

**429 Too Many Requests** - 速率限制
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please try again later.",
    "details": {
      "limit": 100,
      "window": 60,
      "retry_after": 30
    }
  }
}
```

**500 Internal Server Error** - 服务器错误
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to ingest alert: Database connection error"
  }
}
```

---

### 2. 批量接入告警

#### 端点
```
POST /api/v1/alerts/batch
```

#### 请求体 (AlertBatch)

```json
{
  "batch_id": "string (optional)",  // 批次 ID，如果不提供将自动生成
  "alerts": [                       // 告警数组（最多 100 个）
    {
      "alert_id": "string (required)",
      "timestamp": "string (ISO 8601)",
      "alert_type": "enum (required)",
      "severity": "enum (required)",
      "description": "string (required)",
      // ... 其他字段
    },
    // ... 更多告警（最多 100 个）
  ]
}
```

#### 成功响应 (200 OK)

```json
{
  "success": true,
  "data": {
    "batch_id": "BATCH-550e8400-e29b-41d4",
    "total": 100,
    "successful": 98,
    "failed": 2,
    "ingestion_ids": [
      "550e8400-e29b-41d4-a716-446655440000",
      // ... 更多 ingestion_id
    ],
    "errors": [
      {
        "alert_id": "alert-005",
        "error": "Validation error: description is required"
      },
      {
        "alert_id": "alert-099",
        "error": "Validation error: severity must be one of: critical, high, medium, low, info"
      }
    ]
  },
  "meta": {
    "timestamp": "2026-01-06T10:00:00.000000",
    "request_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

#### 错误响应

**413 Payload Too Large** - 超过批量限制
```json
{
  "success": false,
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Batch size exceeds maximum of 100 alerts",
    "details": {
      "max_batch_size": 100,
      "actual_size": 150
    }
  }
}
```

---

### 3. 查询告警状态

#### 端点
```
GET /api/v1/alerts/{alert_id}
```

#### 路径参数
- `alert_id` (string, required) - 告警唯一标识

#### 成功响应 (200 OK)

```json
{
  "success": true,
  "data": {
    "alert_id": "alert-2026-001",
    "status": "processing",  // queued | processing | completed | failed
    "message": "Alert is being processed",
    "created_at": "2026-01-06T10:00:00Z",
    "updated_at": "2026-01-06T10:00:05Z"
  },
  "meta": {
    "timestamp": "2026-01-06T10:00:06.000000",
    "request_id": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

#### 错误响应

**404 Not Found** - 告警不存在
```json
{
  "success": false,
  "error": {
    "code": "ALERT_NOT_FOUND",
    "message": "Alert with ID 'alert-999' not found"
  }
}
```

---

### 4. 健康检查

#### 端点
```
GET /health
```

#### 成功响应 (200 OK)

```json
{
  "status": "healthy",
  "service": "alert-ingestor",
  "timestamp": "2026-01-06T10:00:00.000000",
  "checks": {
    "database": "connected",
    "message_queue": "connected"
  }
}
```

#### 错误响应 (503 Service Unavailable)

```json
{
  "status": "unhealthy",
  "service": "alert-ingestor",
  "error": "Database connection failed"
}
```

---

### 5. 服务指标

#### 端点
```
GET /metrics
```

#### 响应 (200 OK)

```json
{
  "alerts_ingested_total": 15234,
  "alerts_ingested_rate": 125.5,
  "validation_errors_total": 23,
  "rate_limit_violations_total": 5,
  "service": "alert-ingestor"
}
```

---

## 🔐 认证和授权

### JWT 认证（可选，生产环境推荐）

#### 获取 Token

```bash
# 向认证服务请求 token
curl -X POST http://auth-service:8080/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your_username",
    "password": "your_password"
  }'
```

#### 使用 Token

```bash
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -d '{...}'
```

### API Key（简单场景）

```bash
curl -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key_here" \
  -d '{...}'
```

---

## 💡 集成示例

### 1. Python 示例

#### 使用 requests 库

```python
import requests
import json
from datetime import datetime
from typing import Dict, List

class AlertIngestorClient:
    """Alert Ingestor Service 客户端"""

    def __init__(self, base_url: str = "http://localhost:8001", api_key: str = None):
        self.base_url = base_url
        self.session = requests.Session()
        if api_key:
            self.session.headers.update({"X-API-Key": api_key})

    def ingest_alert(self, alert: Dict) -> Dict:
        """接入单个告警"""
        url = f"{self.base_url}/api/v1/alerts"
        response = self.session.post(url, json=alert)
        response.raise_for_status()
        return response.json()

    def ingest_batch(self, alerts: List[Dict], batch_id: str = None) -> Dict:
        """批量接入告警"""
        url = f"{self.base_url}/api/v1/alerts/batch"
        payload = {"alerts": alerts}
        if batch_id:
            payload["batch_id"] = batch_id
        response = self.session.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def get_alert_status(self, alert_id: str) -> Dict:
        """查询告警状态"""
        url = f"{self.base_url}/api/v1/alerts/{alert_id}"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def health_check(self) -> Dict:
        """健康检查"""
        url = f"{self.base_url}/health"
        response = self.session.get(url)
        response.raise_for_status()
        return response.json()


# 使用示例
if __name__ == "__main__":
    client = AlertIngestorClient()

    # 示例 1: 接入单个告警
    alert = {
        "alert_id": "python-test-001",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "alert_type": "malware",
        "severity": "high",
        "description": "Malware detected by EDR",
        "source_ip": "192.168.1.100",
        "target_ip": "10.0.0.50",
        "file_hash": "5d41402abc4b2a76b9719d911017c592",
        "asset_id": "SERVER-001",
        "user_id": "admin"
    }

    result = client.ingest_alert(alert)
    print(f"✓ Alert ingested: {result['data']['ingestion_id']}")

    # 示例 2: 批量接入告警
    alerts = [
        {
            "alert_id": f"python-batch-{i:03d}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "alert_type": "phishing",
            "severity": "medium",
            "description": f"Phishing email {i}"
        }
        for i in range(1, 11)
    ]

    batch_result = client.ingest_batch(alerts, batch_id="PYTHON-BATCH-001")
    print(f"✓ Batch ingested: {batch_result['data']['successful']}/{batch_result['data']['total']}")

    # 示例 3: 查询告警状态
    status = client.get_alert_status("python-test-001")
    print(f"✓ Alert status: {status['data']['status']}")
```

#### 使用 aiohttp 异步客户端

```python
import aiohttp
import asyncio
from datetime import datetime
from typing import Dict, List

class AsyncAlertIngestorClient:
    """异步 Alert Ingestor Service 客户端"""

    def __init__(self, base_url: str = "http://localhost:8001", api_key: str = None):
        self.base_url = base_url
        self.headers = {}
        if api_key:
            self.headers["X-API-Key"] = api_key

    async def ingest_alert(self, alert: Dict) -> Dict:
        """异步接入单个告警"""
        url = f"{self.base_url}/api/v1/alerts"
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=alert, headers=self.headers) as response:
                response.raise_for_status()
                return await response.json()

    async def ingest_batch(self, alerts: List[Dict], batch_id: str = None) -> Dict:
        """异步批量接入告警"""
        url = f"{self.base_url}/api/v1/alerts/batch"
        payload = {"alerts": alerts}
        if batch_id:
            payload["batch_id"] = batch_id

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=self.headers) as response:
                response.raise_for_status()
                return await response.json()


# 使用示例
async def main():
    client = AsyncAlertIngestorClient()

    # 并发提交多个告警
    tasks = []
    for i in range(100):
        alert = {
            "alert_id": f"async-test-{i:03d}",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "alert_type": "anomaly",
            "severity": "low",
            "description": f"Async test alert {i}"
        }
        tasks.append(client.ingest_alert(alert))

    results = await asyncio.gather(*tasks)
    print(f"✓ Ingested {len(results)} alerts concurrently")

if __name__ == "__main__":
    asyncio.run(main())
```

---

### 2. Bash/cURL 示例

#### 单个告警

```bash
#!/bin/bash
# submit_alert.sh

ALERT_URL="http://localhost:8001/api/v1/alerts"

ALERT_JSON='{
  "alert_id": "bash-test-001",
  "timestamp": "2026-01-06T10:00:00Z",
  "alert_type": "malware",
  "severity": "high",
  "description": "Malware detected",
  "source_ip": "192.168.1.100",
  "target_ip": "10.0.0.1",
  "file_hash": "5d41402abc4b2a76b9719d911017c592"
}'

# 提交告警
response=$(curl -s -X POST "$ALERT_URL" \
  -H "Content-Type: application/json" \
  -d "$ALERT_JSON")

# 解析响应
ingestion_id=$(echo "$response" | jq -r '.data.ingestion_id')
status=$(echo "$response" | jq -r '.data.status')

echo "✓ Alert submitted: $ingestion_id"
echo "  Status: $status"

# 检查错误
if echo "$response" | jq -e '.error' > /dev/null; then
  error_msg=$(echo "$response" | jq -r '.error.message')
  echo "✗ Error: $error_msg"
  exit 1
fi
```

#### 批量告警

```bash
#!/bin/bash
# submit_batch.sh

BATCH_URL="http://localhost:8001/api/v1/alerts/batch"

# 生成批量告警
alerts=$(jq -n '{
  batch_id: "BASH-BATCH-001",
  alerts: [range(10) | {
    alert_id: ("bash-batch-" + tostring(.)),
    timestamp: "2026-01-06T10:00:00Z",
    alert_type: "phishing",
    severity: "medium",
    description: ("Phishing test alert " + tostring(.))
  }]
}')

# 提交批量
response=$(curl -s -X POST "$BATCH_URL" \
  -H "Content-Type: application/json" \
  -d "$alerts")

# 解析响应
total=$(echo "$response" | jq -r '.data.total')
successful=$(echo "$response" | jq -r '.data.successful')
failed=$(echo "$response" | jq -r '.data.failed')

echo "✓ Batch submitted"
echo "  Total: $total"
echo "  Successful: $successful"
echo "  Failed: $failed"

# 显示错误（如果有）
if [ "$failed" -gt 0 ]; then
  echo "Errors:"
  echo "$response" | jq -r '.data.errors[]'
fi
```

#### 使用 jq 处理响应

```bash
# 提取 ingestion_id
ingestion_id=$(curl -s -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert_id":"test","alert_type":"malware","severity":"high","description":"test"}' \
  | jq -r '.data.ingestion_id')

echo "Ingestion ID: $ingestion_id"

# 检查成功/失败
success=$(curl -s -X POST http://localhost:8001/api/v1/alerts \
  -H "Content-Type: application/json" \
  -d '{"alert_id":"test","alert_type":"malware","severity":"high","description":"test"}' \
  | jq -r '.success')

if [ "$success" == "true" ]; then
  echo "✓ Alert submitted successfully"
else
  echo "✗ Alert submission failed"
fi
```

---

### 3. JavaScript/Node.js 示例

#### 使用 axios

```javascript
const axios = require('axios');

class AlertIngestorClient {
  constructor(baseUrl = 'http://localhost:8001', apiKey = null) {
    this.baseUrl = baseUrl;
    this.client = axios.create({
      baseURL: baseUrl,
      headers: apiKey ? { 'X-API-Key': apiKey } : {}
    });
  }

  async ingestAlert(alert) {
    try {
      const response = await this.client.post('/api/v1/alerts', alert);
      return response.data;
    } catch (error) {
      console.error('Failed to ingest alert:', error.response?.data || error.message);
      throw error;
    }
  }

  async ingestBatch(alerts, batchId = null) {
    try {
      const payload = { alerts };
      if (batchId) payload.batch_id = batchId;

      const response = await this.client.post('/api/v1/alerts/batch', payload);
      return response.data;
    } catch (error) {
      console.error('Failed to ingest batch:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAlertStatus(alertId) {
    try {
      const response = await this.client.get(`/api/v1/alerts/${alertId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get alert status:', error.response?.data || error.message);
      throw error;
    }
  }
}

// 使用示例
(async () => {
  const client = new AlertIngestorClient();

  // 示例 1: 接入单个告警
  const alert = {
    alert_id: 'nodejs-test-001',
    timestamp: new Date().toISOString(),
    alert_type: 'malware',
    severity: 'high',
    description: 'Malware detected by EDR',
    source_ip: '192.168.1.100',
    target_ip: '10.0.0.50',
    file_hash: '5d41402abc4b2a76b9719d911017c592'
  };

  const result = await client.ingestAlert(alert);
  console.log(`✓ Alert ingested: ${result.data.ingestion_id}`);

  // 示例 2: 批量接入
  const alerts = Array.from({ length: 10 }, (_, i) => ({
    alert_id: `nodejs-batch-${i + 1}`,
    timestamp: new Date().toISOString(),
    alert_type: 'phishing',
    severity: 'medium',
    description: `Phishing email ${i + 1}`
  }));

  const batchResult = await client.ingestBatch(alerts, 'NODEJS-BATCH-001');
  console.log(`✓ Batch: ${batchResult.data.successful}/${batchResult.data.total}`);
})();
```

---

### 4. Java 示例

#### 使用 OkHttp

```java
import okhttp3.*;
import com.google.gson.Gson;
import java.io.IOException;
import java.time.Instant;
import java.util.*;

public class AlertIngestorClient {
    private final OkHttpClient client;
    private final Gson gson;
    private final String baseUrl;

    public AlertIngestorClient(String baseUrl) {
        this.baseUrl = baseUrl;
        this.client = new OkHttpClient();
        this.gson = new Gson();
    }

    public Map<String, Object> ingestAlert(Map<String, Object> alert) throws IOException {
        String json = gson.toJson(alert);

        Request request = new Request.Builder()
            .url(baseUrl + "/api/v1/alerts")
            .post(RequestBody.create(json, MediaType.parse("application/json")))
            .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected code " + response);
            }

            String responseBody = response.body().string();
            return gson.fromJson(responseBody, Map.class);
        }
    }

    public Map<String, Object> ingestBatch(List<Map<String, Object>> alerts, String batchId) throws IOException {
        Map<String, Object> payload = new HashMap<>();
        payload.put("alerts", alerts);
        if (batchId != null) {
            payload.put("batch_id", batchId);
        }

        String json = gson.toJson(payload);

        Request request = new Request.Builder()
            .url(baseUrl + "/api/v1/alerts/batch")
            .post(RequestBody.create(json, MediaType.parse("application/json")))
            .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("Unexpected code " + response);
            }

            String responseBody = response.body().string();
            return gson.fromJson(responseBody, Map.class);
        }
    }

    // 使用示例
    public static void main(String[] args) throws IOException {
        AlertIngestorClient client = new AlertIngestorClient("http://localhost:8001");

        // 示例: 接入单个告警
        Map<String, Object> alert = new HashMap<>();
        alert.put("alert_id", "java-test-001");
        alert.put("timestamp", Instant.now().toString());
        alert.put("alert_type", "malware");
        alert.put("severity", "high");
        alert.put("description", "Malware detected");
        alert.put("source_ip", "192.168.1.100");

        Map<String, Object> result = client.ingestAlert(alert);
        System.out.println("✓ Alert ingested: " + ((Map)result.get("data")).get("ingestion_id"));
    }
}
```

---

### 5. Go 示例

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type AlertIngestorClient struct {
	BaseURL    string
	HTTPClient *http.Client
}

type SecurityAlert struct {
	AlertID    string `json:"alert_id"`
	Timestamp  string `json:"timestamp"`
	AlertType  string `json:"alert_type"`
	Severity   string `json:"severity"`
	Description string `json:"description"`
	SourceIP   string `json:"source_ip,omitempty"`
	TargetIP   string `json:"target_ip,omitempty"`
	FileHash   string `json:"file_hash,omitempty"`
}

type IngestResponse struct {
	Success bool `json:"success"`
	Data    struct {
		IngestionID string `json:"ingestion_id"`
		AlertID     string `json:"alert_id"`
		Status      string `json:"status"`
	} `json:"data"`
}

func NewClient(baseURL string) *AlertIngestorClient {
	return &AlertIngestorClient{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *AlertIngestorClient) IngestAlert(alert SecurityAlert) (*IngestResponse, error) {
	jsonData, err := json.Marshal(alert)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest("POST", c.BaseURL+"/api/v1/alerts", bytes.NewBuffer(jsonData))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result IngestResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}

// 使用示例
func main() {
	client := NewClient("http://localhost:8001")

	alert := SecurityAlert{
		AlertID:    "go-test-001",
		Timestamp:  time.Now().Format(time.RFC3339),
		AlertType:  "malware",
		Severity:   "high",
		Description: "Malware detected",
		SourceIP:   "192.168.1.100",
	}

	result, err := client.IngestAlert(alert)
	if err != nil {
		fmt.Printf("✗ Error: %v\n", err)
		return
	}

	fmt.Printf("✓ Alert ingested: %s\n", result.Data.IngestionID)
}
```

---

## 🔄 与不同系统的对接

### Splunk 集成

#### 使用 Splunk Webhook

```python
# 在 Splunk 中配置 webhook alert action
# URL: http://your-ingestor:8001/api/v1/alerts

# Splunk alert -> 转换为标准格式
def splunk_to_standard(splunk_alert):
    return {
        "alert_id": splunk_alert.get("result_id", f"splunk-{uuid.uuid4()}"),
        "timestamp": splunk_alert.get("_time", datetime.utcnow().isoformat()),
        "alert_type": map_splunk_type(splunk_alert.get("category")),
        "severity": map_splunk_severity(splunk_alert.get("severity")),
        "description": splunk_alert.get("message", ""),
        "source_ip": splunk_alert.get("src_ip"),
        "target_ip": splunk_alert.get("dest_ip"),
        "user": splunk_alert.get("user"),
        "raw_data": splunk_alert
    }
```

#### Splunk 集成脚本

```bash
#!/bin/bash
# Splunk scripted alert

# Splunk 传递的环境变量
# $SPLUNK_ARG_1, $SPLUNK_ARG_2, ... (search results)
# $SPLUNK_ARG_8 (alert severity)

ALERT_URL="http://localhost:8001/api/v1/alerts"

# 构造告警 JSON
ALERT_JSON=$(cat <<EOF
{
  "alert_id": "splunk-$SPLUNK_ARG_0",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "alert_type": "intrusion",
  "severity": "$SPLUNK_ARG_8",
  "description": "Splunk alert: $SPLUNK_ARG_4",
  "source_ip": "$SPLUNK_ARG_3",
  "raw_data": {
    "splunk_search": "$SPLUNK_ARG_4",
    "splunk_server": "$SPLUNK_ARG_5"
  }
}
EOF
)

# 提交告警
curl -s -X POST "$ALERT_URL" \
  -H "Content-Type: application/json" \
  -d "$ALERT_JSON"
```

---

### QRadar 集成

#### QRadar REST API 转发

```python
import requests
from qradar import QRadarClient

def qradar_forward_alerts(qradar_url, ingestor_url, api_token):
    """从 QRadar 获取告警并转发到 Alert Ingestor"""

    # 连接到 QRadar
    qradar = QRadarClient(qradar_url, api_token)

    # 获取 offenses（告警）
    offenses = qradar.get_offenses(filter="status=OPEN")

    for offense in offenses:
        # 转换为标准格式
        alert = {
            "alert_id": f"qradar-{offense['id']}",
            "timestamp": offense["start_time"],
            "alert_type": map_qradar_type(offense["offense_type"]),
            "severity": map_qradar_severity(offense["severity"]),
            "description": offense["description"],
            "source_ip": offense["source_address"],
            "target_ip": offense["destination_address"],
            "asset_id": offense["offending_endpoint"],
            "raw_data": offense
        }

        # 转发到 Alert Ingestor
        response = requests.post(
            f"{ingestor_url}/api/v1/alerts",
            json=alert
        )

        if response.status_code == 200:
            print(f"✓ Forwarded QRadar offense {offense['id']}")
        else:
            print(f"✗ Failed to forward offense {offense['id']}")
```

---

### Elasticsearch/OpenSearch 集成

#### 使用 Elasticsearch Watcher

```json
{
  "trigger": {
    "schedule": {
      "interval": "1m"
    }
  },
  "input": {
    "search": {
      "request": {
        "indices": ["logs-*"],
        "body": {
          "query": {
            "bool": {
              "must": [
                {"range": {"@timestamp": {"gte": "now-1m"}}},
                {"match": {"event.type": "alert"}}
              ]
            }
          }
        }
      }
    }
  },
  "condition": {
    "compare": {
      "ctx.payload.hits.total": {
        "gt": 0
      }
    }
  },
  "actions": {
    "send_alert": {
      "webhook": {
        "scheme": "http",
        "host": "localhost",
        "port": 8001,
        "path": "/api/v1/alerts",
        "method": "POST",
        "headers": {
          "Content-Type": "application/json"
        },
        "body": "{{#toJson}}ctx.payload.hits.hits{{/toJson}}"
      }
    }
  }
}
```

---

## 📊 错误码参考

| 错误码 | HTTP 状态 | 描述 | 解决方案 |
|--------|----------|------|----------|
| `VALIDATION_ERROR` | 400 | 请求参数验证失败 | 检查必填字段和数据类型 |
| `ALERT_NOT_FOUND` | 404 | 告警不存在 | 确认 alert_id 正确 |
| `RATE_LIMIT_EXCEEDED` | 429 | 速率限制超出 | 减慢请求频率或联系管理员增加限制 |
| `PAYLOAD_TOO_LARGE` | 413 | 批量大小超过限制 | 分批提交，每批最多 100 个 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 | 联系系统管理员 |
| `SERVICE_UNAVAILABLE` | 503 | 服务暂时不可用 | 等待后重试 |

---

## 🧪 测试和调试

### 单元测试示例

```python
import pytest
import requests

class TestAlertIngestorAPI:
    BASE_URL = "http://localhost:8001"

    def test_health_check(self):
        """测试健康检查端点"""
        response = requests.get(f"{self.BASE_URL}/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"

    def test_ingest_single_alert(self):
        """测试接入单个告警"""
        alert = {
            "alert_id": "test-001",
            "timestamp": "2026-01-06T10:00:00Z",
            "alert_type": "malware",
            "severity": "high",
            "description": "Test alert"
        }

        response = requests.post(f"{self.BASE_URL}/api/v1/alerts", json=alert)
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is True
        assert "ingestion_id" in data["data"]

    def test_validation_error(self):
        """测试验证错误"""
        invalid_alert = {
            "alert_type": "malware",
            # 缺少必填字段: alert_id, severity, description
        }

        response = requests.post(f"{self.BASE_URL}/api/v1/alerts", json=invalid_alert)
        assert response.status_code == 400

        data = response.json()
        assert data["success"] is False
        assert data["error"]["code"] == "VALIDATION_ERROR"
```

### 使用 Postman Collection

```json
{
  "info": {
    "name": "Alert Ingestor API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Health Check",
      "request": {
        "method": "GET",
        "url": "{{base_url}}/health"
      }
    },
    {
      "name": "Ingest Alert",
      "request": {
        "method": "POST",
        "header": [
          {"key": "Content-Type", "value": "application/json"}
        ],
        "body": {
          "mode": "raw",
          "raw": "{\n  \"alert_id\": \"{{$randomUUID}}\",\n  \"timestamp\": \"{{$timestamp}}\",\n  \"alert_type\": \"malware\",\n  \"severity\": \"high\",\n  \"description\": \"Test alert\"\n}"
        },
        "url": "{{base_url}}/api/v1/alerts"
      }
    }
  ],
  "variable": [
    {"key": "base_url", "value": "http://localhost:8001"}
  ]
}
```

---

## 📈 性能优化建议

### 1. 批量提交

```python
# 不推荐：逐个提交
for alert in alerts:
    client.ingest_alert(alert)  # 100 次 HTTP 请求

# 推荐：批量提交
client.ingest_batch(alerts)  # 1 次 HTTP 请求
```

### 2. 异步提交

```python
import asyncio

async def ingest_async(alerts):
    client = AsyncAlertIngestorClient()
    tasks = [client.ingest_alert(alert) for alert in alerts]
    await asyncio.gather(*tasks)

# 并发提交 100 个告警
asyncio.run(ingest_async(alerts))
```

### 3. 连接池复用

```python
# 不推荐：每次创建新连接
for alert in alerts:
    response = requests.post(url, json=alert)

# 推荐：复用 Session
session = requests.Session()
for alert in alerts:
    response = session.post(url, json=alert)
```

### 4. 压缩请求体（大数据量）

```python
import gzip
import requests

data = json.dumps(large_alert_batch)
compressed_data = gzip.compress(data.encode())

response = requests.post(
    url,
    data=compressed_data,
    headers={"Content-Encoding": "gzip"}
)
```

---

## 📚 相关文档

- **Stage 1 部署文档**: `/Users/newmba/security/STAGE1_DEPLOYMENT.md`
- **Stage 1 功能总结**: `/Users/newmba/security/STAGE1_SUMMARY.md`
- **API 设计规范**: `/Users/newmba/security/docs/05_api_design.md`
- **数据模型**: `/Users/newmba/security/services/shared/models/`

---

## 🆘 支持和联系

**技术支持**: CCR <chenchunrun@gmail.com>
**API 版本**: v1
**文档版本**: 1.0
**最后更新**: 2026-01-06

---

**附录**:
- [Postman Collection](./assets/postman/Alert_Ingestor_API.postman_collection.json)
- [OpenAPI/Swagger Spec](./assets/openapi/alert_ingestor.yaml)
- [示例代码](./examples/integration/)
