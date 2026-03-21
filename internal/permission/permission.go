package permission

import (
	"time"
)

// PermissionLevel 权限级别
type PermissionLevel string

const (
	LevelViewer    PermissionLevel = "viewer"
	LevelOperator  PermissionLevel = "operator"
	LevelAdmin     PermissionLevel = "admin"
	LevelAnalyst   PermissionLevel = "analyst"
)

// ResourceType 资源类型
type ResourceType string

const (
	ResourceTypeFile      ResourceType = "file"
	ResourceTypeNetwork   ResourceType = "network"
	ResourceTypeProcess   ResourceType = "process"
	ResourceTypeDatabase  ResourceType = "database"
	ResourceTypeCommand   ResourceType = "command"
	ResourceTypeSystem    ResourceType = "system"
)

// Severity 严重级别
type Severity string

const (
	SeverityCritical Severity = "critical"
	SeverityHigh     Severity = "high"
	SeverityMedium   Severity = "medium"
	SeverityLow      Severity = "low"
)

// PermissionDecision 权限决策
type PermissionDecision string

const (
	DecisionAutoApprove   PermissionDecision = "auto_approve"
	DecisionUserConfirm   PermissionDecision = "user_confirm"
	DecisionAdminReview   PermissionDecision = "admin_review"
	DecisionDeny          PermissionDecision = "deny"
)

// PermissionRequest 权限请求（扩展版本）
type PermissionRequest struct {
	// 基础字段（原有）
	ID          string `json:"id"`
	SessionID   string `json:"session_id"`
	ToolCallID  string `json:"tool_call_id"`
	ToolName    string `json:"tool_name"`
	Description string `json:"description"`
	Action      string `json:"action"` // read, write, execute, delete
	Params      any    `json:"params"`
	Path        string `json:"path"`

	// 新增字段：资源信息
	ResourceType ResourceType `json:"resource_type"`
	ResourcePath string       `json:"resource_path"`

	// 新增字段：安全信息
	Severity  Severity  `json:"severity"`
	RiskScore int       `json:"risk_score"` // 0-100
	Decision  PermissionDecision `json:"decision"`

	// 新增字段：用户和角色信息
	UserID      string          `json:"user_id"`
	Username    string          `json:"username"`
	RequiredRole PermissionLevel `json:"required_role"`

	// 新增字段：网络和审计信息
	SourceIP    string    `json:"source_ip"`
	RequestTime time.Time `json:"request_time"`

	// 新增字段：变更和合规
	ApprovalID  string `json:"approval_id"` // 变更单ID
	Reason      string `json:"reason"`      // 申请原因
	RiskFactors []string `json:"risk_factors"` // 风险因子列表

	// 新增字段：决策信息
	ApprovedBy  string    `json:"approved_by"`
	ApprovedAt  time.Time `json:"approved_at"`
	DeniedReason string   `json:"denied_reason"`
}

// Service 权限服务接口
type Service interface {
	// 请求权限
	Request(req *PermissionRequest) error

	// 检查权限
	Check(sessionID, toolName string) (bool, error)

	// 检查能力
	CheckCapability(userID, capability string) (bool, error)

	// 评估风险
	EvaluateRisk(req *PermissionRequest) (int, Severity, error)

	// 获取决策
	MakeDecision(req *PermissionRequest) (PermissionDecision, error)

	// 审计记录
	AuditLog(req *PermissionRequest, decision PermissionDecision) error
}

// DefaultService 默认权限服务实现
type DefaultService struct {
	// TODO: 添加依赖项（数据库、日志等）
}

// NewDefaultService 创建默认权限服务
func NewDefaultService() *DefaultService {
	return &DefaultService{}
}

// Request 实现 Service.Request
func (ds *DefaultService) Request(req *PermissionRequest) error {
	// TODO: 实现权限请求逻辑
	return nil
}

// Check 实现 Service.Check
func (ds *DefaultService) Check(sessionID, toolName string) (bool, error) {
	// TODO: 实现权限检查逻辑
	return false, nil
}

// CheckCapability 实现 Service.CheckCapability
func (ds *DefaultService) CheckCapability(userID, capability string) (bool, error) {
	// TODO: 实现能力检查逻辑
	return false, nil
}

// EvaluateRisk 实现 Service.EvaluateRisk
func (ds *DefaultService) EvaluateRisk(req *PermissionRequest) (int, Severity, error) {
	// TODO: 实现风险评估逻辑
	return 0, SeverityLow, nil
}

// MakeDecision 实现 Service.MakeDecision
func (ds *DefaultService) MakeDecision(req *PermissionRequest) (PermissionDecision, error) {
	// TODO: 实现决策逻辑
	return DecisionDeny, nil
}

// AuditLog 实现 Service.AuditLog
func (ds *DefaultService) AuditLog(req *PermissionRequest, decision PermissionDecision) error {
	// TODO: 实现审计日志逻辑
	return nil
}
