# 数据库设计文档

**版本**: v1.0
**日期**: 2025-01-05
**数据库**: PostgreSQL 15+

---

## 1. 数据库架构

### 1.1 架构概览

```
┌────────────────────────────────────────────────────────────────────┐
│                     数据库架构                                       │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐        │
│  │ Application  │───►│  PostgreSQL  │◄───│  Backup      │        │
│  │   Layer      │    │   Primary    │    │   System     │        │
│  └──────────────┘    └──────┬───────┘    └──────────────┘        │
│                             │                                   │
│                    Streaming Replication                         │
│                             │                                   │
│              ┌──────────────┴──────────────┐                    │
│              ▼                             ▼                    │
│     ┌──────────────┐              ┌──────────────┐             │
│     │ PostgreSQL  │              │ PostgreSQL  │             │
│     │  Standby 1  │              │  Standby 2  │             │
│     │  (Read)     │              │  (Read)     │             │
│     └──────────────┘              └──────────────┘             │
│                                                                     │
│  HA: Patroni + etcd                                                  │
│  Backup: pgBackRest + WAL归档                                         │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据表设计

### 2.1 核心表

#### 2.1.1 alerts (告警表)

```sql
CREATE TABLE alerts (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 告警标识
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    ingestion_id VARCHAR(100),

    -- 告警内容
    original_json JSONB NOT NULL,
    normalized_json JSONB,

    -- 告警分类
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    category VARCHAR(50),

    -- 网络信息
    source_ip INET,
    source_port INT,
    target_ip INET,
    target_port INT,
    protocol VARCHAR(20),

    -- IOC信息
    file_hash VARCHAR(128),
    domain VARCHAR(255),
    url TEXT,
    email VARCHAR(255),

    -- 告警描述
    title VARCHAR(500),
    description TEXT,

    -- 关联信息
    asset_id UUID REFERENCES assets(id),
    user_id UUID REFERENCES users(id),

    -- 处理状态
    status VARCHAR(20) DEFAULT 'new' CHECK (status IN (
        'new', 'assigned', 'in_progress', 'resolved', 'rejected', 'closed'
    )),
    assigned_to UUID REFERENCES users(id),

    -- AI研判结果
    risk_score FLOAT CHECK (risk_score BETWEEN 0 AND 100),
    risk_level VARCHAR(20) CHECK (risk_level IN ('critical', 'high', 'medium', 'low', 'info')),
    confidence FLOAT CHECK (confidence BETWEEN 0 AND 1),
    requires_human_review BOOLEAN DEFAULT false,
    triage_result_id UUID REFERENCES triage_results(id),

    -- 时间戳
    received_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    first_seen_at TIMESTAMP WITH TIME ZONE,
    last_seen_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,

    -- 元数据
    source_system VARCHAR(100),
    tags TEXT[] DEFAULT '{}',
    labels JSONB DEFAULT '{}',

    -- 索引
    INDEX idx_alerts_alert_id (alert_id),
    INDEX idx_alerts_status (status),
    INDEX idx_alerts_severity (severity),
    INDEX idx_alerts_risk_score (risk_score),
    INDEX idx_alerts_created_at (created_at DESC),
    INDEX idx_alerts_source_ip (source_ip),
    INDEX idx_alerts_assigned_to (assigned_to),
    INDEX idx_alerts_asset_id (asset_id),
    INDEX idx_alerts_tags (tags),
    INDEX idx_alerts_gin_data (normalized_json),
    INDEX idx_alerts_gin_labels (labels)
);

-- 触发器: 自动更新updated_at
CREATE TRIGGER update_alerts_updated_at
    BEFORE UPDATE ON alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

#### 2.1.2 triage_results (研判结果表)

```sql
CREATE TABLE triage_results (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,

    -- 风险评估
    risk_score FLOAT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    risk_level VARCHAR(20) NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence BETWEEN 0 AND 1),

    -- 关键因素
    key_factors TEXT[] NOT NULL,

    -- 评分组件
    severity_score FLOAT,
    threat_intel_score FLOAT,
    asset_criticality_score FLOAT,
    exploitability_score FLOAT,

    -- 处置建议
    remediation JSONB NOT NULL,

    -- 相似告警
    similar_alerts JSONB DEFAULT '[]',

    -- AI分析
    ai_analysis JSONB,

    -- 性能指标
    processing_time_ms INT,

    -- 模型信息
    model_used VARCHAR(100),
    model_version VARCHAR(50),

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 索引
    INDEX idx_triage_results_alert_id (alert_id),
    INDEX idx_triage_results_risk_score (risk_score),
    INDEX idx_triage_results_created_at (created_at DESC)
);
```

#### 2.1.3 threat_intel (威胁情报表)

```sql
CREATE TABLE threat_intel (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- IOC信息
    ioc VARCHAR(500) NOT NULL,
    ioc_type VARCHAR(20) NOT NULL CHECK (ioc_type IN (
        'ip', 'domain', 'hash', 'url', 'email'
    )),

    -- 威胁评级
    threat_level VARCHAR(20) CHECK (threat_level IN (
        'critical', 'high', 'medium', 'low', 'info'
    )),
    threat_score FLOAT CHECK (threat_score BETWEEN 0 AND 10),
    confidence FLOAT CHECK (confidence BETWEEN 0 AND 1),

    -- 恶意判定
    is_malicious BOOLEAN DEFAULT false,
    classification VARCHAR(50),

    -- 情报来源
    sources JSONB NOT NULL DEFAULT '[]',
    source_count INT DEFAULT 0,

    -- 关联信息
    tags TEXT[] DEFAULT '{}',
    campaigns TEXT[] DEFAULT '{}',
    malware_families TEXT[] DEFAULT '{}',

    -- 时间信息
    first_seen TIMESTAMP WITH TIME ZONE,
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- TTL (缓存过期)
    ttl INTERVAL DEFAULT '24 hours',
    expires_at TIMESTAMP WITH TIME ZONE GENERATED ALWAYS AS (updated_at + ttl) STORED,

    -- 唯一约束
    UNIQUE(ioc, ioc_type),

    -- 索引
    INDEX idx_threat_intel_ioc (ioc),
    INDEX idx_threat_intel_ioc_type (ioc_type),
    INDEX idx_threat_intel_threat_level (threat_level),
    INDEX idx_threat_intel_is_malicious (is_malicious),
    INDEX idx_threat_intel_expires_at (expires_at),
    INDEX idx_threat_intel_gin_tags (tags)
);

-- 触发器: 自动更新updated_at
CREATE TRIGGER update_threat_intel_updated_at
    BEFORE UPDATE ON threat_intel
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 自动清理过期数据
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('cleanup-expired-threat-intel', '0 * * * *', $$
    DELETE FROM threat_intel WHERE expires_at < NOW();
$$);
```

#### 2.1.4 alert_context (告警上下文表)

```sql
CREATE TABLE alert_context (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,

    -- 上下文类型
    context_type VARCHAR(20) NOT NULL CHECK (context_type IN (
        'network', 'asset', 'user', 'geo', 'vulnerability'
    )),

    -- 上下文数据
    context_data JSONB NOT NULL,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 唯一约束
    UNIQUE(alert_id, context_type),

    -- 索引
    INDEX idx_alert_context_alert_id (alert_id),
    INDEX idx_alert_context_type (context_type)
);

-- 触发器
CREATE TRIGGER update_alert_context_updated_at
    BEFORE UPDATE ON alert_context
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

#### 2.1.5 users (用户表)

```sql
CREATE TABLE users (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 用户信息
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(20),

    -- 认证
    password_hash VARCHAR(255) NOT NULL,
    mfa_enabled BOOLEAN DEFAULT false,
    mfa_secret VARCHAR(255),

    -- 状态
    is_active BOOLEAN DEFAULT true,
    is_verified BOOLEAN DEFAULT false,

    -- 角色权限
    role VARCHAR(50) DEFAULT 'analyst' CHECK (role IN (
        'admin', 'supervisor', 'analyst', 'viewer', 'auditor'
    )),

    -- 组织信息
    department VARCHAR(100),
    team VARCHAR(100),
    manager_id UUID REFERENCES users(id),

    -- 技能标签
    skills TEXT[] DEFAULT '{}',

    -- 时间戳
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 索引
    INDEX idx_users_username (username),
    INDEX idx_users_email (email),
    INDEX idx_users_role (role),
    INDEX idx_users_is_active (is_active)
);

-- 触发器
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

#### 2.1.6 assets (资产表)

```sql
CREATE TABLE assets (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 资产标识
    asset_id VARCHAR(100) UNIQUE NOT NULL,
    asset_name VARCHAR(255) NOT NULL,
    asset_type VARCHAR(50) NOT NULL CHECK (asset_type IN (
        'server', 'workstation', 'network', 'database', 'application', 'other'
    )),

    -- 网络信息
    ip_address INET,
    mac_address MACADDR,
    hostname VARCHAR(255),

    -- 环境信息
    environment VARCHAR(20) CHECK (environment IN (
        'production', 'staging', 'development', 'test'
    )),

    -- 重要性
    criticality VARCHAR(20) DEFAULT 'medium' CHECK (criticality IN (
        'critical', 'high', 'medium', 'low'
    )),

    -- 所有者信息
    owner VARCHAR(255),
    owner_department VARCHAR(100),
    business_unit VARCHAR(100),

    -- 系统信息
    os_name VARCHAR(100),
    os_version VARCHAR(100),
    platform VARCHAR(50),

    -- 漏洞信息
    vulnerability_count JSONB DEFAULT '{}',
    patch_status VARCHAR(20) DEFAULT 'unknown',

    -- 位置信息
    location VARCHAR(100),
    data_center VARCHAR(100),

    -- 时间戳
    last_scan_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 索引
    INDEX idx_assets_asset_id (asset_id),
    INDEX idx_assets_ip_address (ip_address),
    INDEX idx_assets_hostname (hostname),
    INDEX idx_assets_criticality (criticality),
    INDEX idx_assets_environment (environment)
);

-- 触发器
CREATE TRIGGER update_assets_updated_at
    BEFORE UPDATE ON assets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

#### 2.1.7 incidents (事件表)

```sql
CREATE TABLE incidents (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id VARCHAR(100) UNIQUE NOT NULL,

    -- 关联告警
    alert_ids UUID[] NOT NULL,

    -- 事件信息
    title VARCHAR(500) NOT NULL,
    description TEXT,
    incident_type VARCHAR(50),

    -- 严重等级
    severity VARCHAR(20) NOT NULL CHECK (severity IN (
        'critical', 'high', 'medium', 'low'
    )),

    -- 状态
    status VARCHAR(20) DEFAULT 'open' CHECK (status IN (
        'open', 'investigating', 'contained', 'eradicated', 'resolved', 'closed'
    )),

    -- 分配
    assigned_to UUID REFERENCES users(id),
    team VARCHAR(100),

    -- 时间线
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reported_at TIMESTAMP WITH TIME ZONE,
    contained_at TIMESTAMP WITH TIME ZONE,
    eradicated_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,

    -- 影响
    impact_assessment JSONB,
    affected_assets UUID[] REFERENCES assets(id),

    -- 根因分析
    root_cause TEXT,
    kill_chain JSONB,

    -- 响应行动
    response_actions JSONB DEFAULT '[]',
    lessons_learned TEXT,

    -- 元数据
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 索引
    INDEX idx_incidents_incident_id (incident_id),
    INDEX idx_incidents_status (status),
    INDEX idx_incidents_severity (severity),
    INDEX idx_incidents_assigned_to (assigned_to),
    INDEX idx_incidents_created_at (created_at DESC)
);

-- 触发器
CREATE TRIGGER update_incidents_updated_at
    BEFORE UPDATE ON incidents
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

#### 2.1.8 audit_logs (审计日志表)

```sql
CREATE TABLE audit_logs (
    -- 主键
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 操作信息
    actor_id UUID REFERENCES users(id),
    actor_type VARCHAR(20) CHECK (actor_type IN ('user', 'system', 'api')),
    action VARCHAR(100) NOT NULL,

    -- 资源信息
    resource_type VARCHAR(50),
    resource_id UUID,

    -- 变更内容
    old_values JSONB,
    new_values JSONB,

    -- 请求信息
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(100),

    -- 结果
    status VARCHAR(20) CHECK (status IN ('success', 'failure', 'partial')),
    error_message TEXT,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 索引
    INDEX idx_audit_logs_actor_id (actor_id),
    INDEX idx_audit_logs_action (action),
    INDEX idx_audit_logs_resource (resource_type, resource_id),
    INDEX idx_audit_logs_created_at (created_at DESC),
    INDEX idx_audit_logs_request_id (request_id)
);
```

---

## 3. 数据分区策略

### 3.1 按时间分区

```sql
-- alerts表按月分区
CREATE TABLE alerts_partitioned (
    LIKE alerts INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- 创建分区
CREATE TABLE alerts_2025_01 PARTITION OF alerts_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE alerts_2025_02 PARTITION OF alerts_partitioned
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- 自动创建未来分区
CREATE OR REPLACE FUNCTION create_monthly_partition()
RETURNS void AS $$
DECLARE
    partition_date DATE;
    partition_name TEXT;
    start_date TEXT;
    end_date TEXT;
BEGIN
    partition_date := date_trunc('month', NOW() + interval '1 month');
    partition_name := 'alerts_' || to_char(partition_date, 'YYYY_MM');
    start_date := partition_date::TEXT;
    end_date := (partition_date + interval '1 month')::TEXT;

    EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF alerts_partitioned
         FOR VALUES FROM (%L) TO (%L)',
        partition_name, start_date, end_date
    );
END;
$$ LANGUAGE plpgsql;

-- 定时任务
SELECT cron.schedule('create-partition', '0 0 1 * *', $$
    SELECT create_monthly_partition();
$$);
```

---

## 4. 数据迁移

### 4.1 初始化脚本

```bash
#!/bin/bash
# scripts/init_db.sh

set -e

DB_NAME=${DB_NAME:-security_triage}
DB_USER=${DB_USER:-triage}
DB_PASSWORD=${DB_PASSWORD:-password}
PG_HOST=${PG_HOST:-localhost}
PG_PORT=${PG_PORT:-5432}

echo "Creating database..."
psql -h $PG_HOST -p $PG_PORT -U postgres <<-EOF
CREATE DATABASE $DB_NAME;
CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF

echo "Running migrations..."
for migration in migrations/*.sql; do
    echo "Running $migration..."
    psql -h $PG_HOST -p $PG_PORT -U $DB_USER -d $DB_NAME -f $migration
done

echo "Database initialization complete!"
```

---

**文档版本**: v1.0
**最后更新**: 2025-01-05
**下一步**: 查看[POC实施方案](./06_poc_implementation.md)
