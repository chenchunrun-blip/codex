# Security Audit Checklist

This checklist provides a comprehensive guide for security auditing and hardening of the Security Alert Triage System.

## Table of Contents

1. [Authentication & Authorization](#authentication--authorization)
2. [API Security](#api-security)
3. [Data Protection](#data-protection)
4. [Network Security](#network-security)
5. [Container Security](#container-security)
6. [Infrastructure Security](#infrastructure-security)
7. [Logging & Monitoring](#logging--monitoring)
8. [Compliance](#compliance)

---

## Authentication & Authorization

### Password Policy
- [ ] Password minimum length: 12 characters
- [ ] Password complexity required (upper, lower, digit, special)
- [ ] Password expiration: 90 days
- [ ] Password history: 5 passwords
- [ ] Failed login lockout: 5 attempts
- [ ] Lockout duration: 15 minutes
- [ ] Strong password hashing (bcrypt, 12+ rounds)

### JWT Token Security
- [ ] Tokens have short expiration (access: 30 min, refresh: 7 days)
- [ ] Secret key is cryptographically random (32+ bytes)
- [ ] Secret key stored securely (environment variable/KMS)
- [ ] Token signing algorithm: HS256 or RS256
- [ ] Token includes jti claim for revocation tracking
- [ ] Refresh token rotation on each use
- [ ] Tokens stored in HTTP-only cookies (if using cookies)

### Session Management
- [ ] Session timeout: 30 minutes of inactivity
- [ ] Concurrent session limits: 3 per user
- [ ] Secure session destruction on logout
- [ ] Session invalidation on password change
- [ ] Session fixation protection

### Multi-Factor Authentication (MFA)
- [ ] MFA required for admin users
- [ ] MFA required for critical operations
- [ ] Backup codes available
- [ ] MFA bypass list for emergencies

### RBAC Configuration
- [ ] Role hierarchy defined (Admin > Analyst > Operator > Viewer)
- [ ] Principle of least privilege enforced
- [ ] Permission audits enabled
- [ ] Role assignment requires approval
- [ ] Regular permission reviews (quarterly)

---

## API Security

### Input Validation
- [ ] All user inputs validated with Pydantic schemas
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (output encoding, CSP headers)
- [ ] CSRF protection enabled
- [ ] File upload validation (type, size, content)
- [ ] Path traversal prevention
- [ ] Command injection prevention

### Rate Limiting
- [ ] API rate limiting configured (100 req/min per user)
- [ ] Authentication rate limiting (5 attempts/min)
- [ ] IP-based blocking for abuse
- [ ] Distributed rate limiting (Redis)

### CORS Configuration
- [ ] CORS restricted to allowed origins
- [ ] Credentials not allowed for cross-origin requests
- [ ] Exposed headers minimized

### API Versioning
- [ ] API versioned (/api/v1/)
- [ ] Deprecation policy documented
- [ ] Breaking changes communicated in advance

### Security Headers
- [ ] `X-Content-Type-Options: nosniff`
- [ ] `X-Frame-Options: DENY`
- [ ] `X-XSS-Protection: 1; mode=block`
- [ ] `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- [ ] `Content-Security-Policy` defined
- [ ] `Referrer-Policy: strict-origin-when-cross-origin`

---

## Data Protection

### Encryption at Rest
- [ ] Database encryption enabled (PostgreSQL with ssl=on)
- [ ] Encrypted volumes (AWS EBS encryption)
- [ ] Secrets encrypted in etcd (Kubernetes secrets)
- [ ] Backup encryption enabled
- [ ] Encryption key rotation policy (quarterly)

### Encryption in Transit
- [ ] TLS 1.3+ required for all communications
- [ ] TLS enforced for database connections
- [ ] TLS enforced for Redis (stunnel)
- [ ] TLS enforced for RabbitMQ
- [ ] Certificate validation enabled (no self-signed in production)
- [ ] Forward secrecy (Ephemeral Diffie-Hellman)

### Sensitive Data Handling
- [ ] API keys encrypted in database (Fernet)
- [ ] API keys never logged
- [ ] Passwords never logged
- [ ] Credit card numbers not stored
- [ ] PII data access logged and audited
- [ ] Data retention policy defined
- [ ] Secure data deletion procedures

### Backup Security
- [ ] Backups encrypted
- [ ] Backup access restricted (RBAC)
- [ ] Backup tested quarterly
- [ ] Off-site backup storage
- [ ] Backup retention period: 90 days
- [ ] Backup restoration procedures documented

---

## Network Security

### Firewall Rules
- [ ] Only necessary ports exposed
- [ ] Ingress rules: 80, 443, 22 (bastion only)
- [ ] Egress rules restricted to required destinations
- [ ] Database access only from application pods
- [ ] Inter-pod communication allowed
- [ ] Network segmentation implemented

### Kubernetes Network Policies
- [ ] Default deny-all policy
- [ ] Namespace-specific policies
- [ ] Services can only communicate as required
- [ ] External access only via ingress

### Service Mesh
- [ ] mTLS enabled between services
- [ ] Service-to-service authentication
- [ ] Traffic encryption enabled

### Load Balancer
- [ ] SSL/TLS termination at edge
- [ ] HTTP to HTTPS redirect
- [ ] DDoS protection enabled
- [ ] Web Application Firewall (WAF) rules

### Private Network
- [ ] Services in private subnets
- [ ] Database in private subnets
- [ ] No public IP for database/cache
- [ ] NAT gateway for internet access

---

## Container Security

### Image Security
- [ ] Images scanned for vulnerabilities
- [ ] Images signed and verified
- [ ] Base images minimal (alpine)
- [ ] No root user in containers
- [ ] Image provenance tracked
- [ ] Image update policy defined

### Runtime Security
- [ ] Containers run as non-root user
- [ ] Read-only root filesystem where possible
- [ ] Resource limits enforced (CPU, memory)
- [ ] Security context (capabilities) minimized
- [ ] Seccomp profiles applied
- [ ] AppArmor/SELinux enabled

### Pod Security Policies (PSP)
- [ ] PSP enforced (or Pod Security Standards in K8s 1.25+)
- [ ] Privileged pods prohibited
- [ ] HostPID/HostIPC disabled
- [ ] Volume types restricted

### Secret Management
- [ ] Secrets not stored in environment variables (use files/volumes)
- [ ] Secrets mounted as read-only
- [ ] External secrets management (HashiCorp Vault, AWS Secrets Manager)
- [ ] Secret rotation automated
- [ ] Secret access logged

---

## Infrastructure Security

### Node Security
- [ ] OS patches applied regularly
- [ ] Automatic security updates enabled
- [ ] Unnecessary services disabled
- [ ] SSH key-based authentication only
- [ ] Root login disabled
- [ ] Security monitoring enabled

### Cluster Security
- [ ] RBAC enabled (Role-Based Access Control)
- [ ] Anonymous access disabled
- [ ] Authorization mode: Node + RBAC
- [ ] Admission controllers enabled
- [ ] PodSecurityPolicy admission controller
- [ ] Resource quotas enforced per namespace
- [ ] LimitRange enforced

### Cloud Provider Security
- [ ] IAM roles minimized (least privilege)
- [ ] No long-lived access keys
- [ ] MFA enforced for AWS/GCP root account
- [ ] CloudTrail/Cloud Audit Logs enabled
- [ ] GuardDuty/Security Center enabled
- [ ] VPC flow logs collected

### Supply Chain Security
- [ ] SBOM (Software Bill of Materials) generated
- [ ] Dependencies scanned for vulnerabilities
- [ ] License compliance verified
- [ ] Third-party libraries vetted
- [ ] Dependency pinning (poetry.lock, package-lock.json)

---

## Logging & Monitoring

### Audit Logging
- [ ] All authentication attempts logged
- [ ] All authorization failures logged
- [ ] Configuration changes logged
- [ ] Data access logged
- [ ] Privileged actions logged
- [ ] Logs include: who, what, when, where, result
- [ ] Logs tamper-evident
- [ ] Logs retained for 90 days minimum

### Security Event Monitoring
- [ ] Failed login attempts monitored
- [ ] Unusual access patterns detected
- [ ] Anomaly detection enabled
- [ ] Intrusion detection (IDS)
- [ ] DLP (Data Loss Prevention) enabled

### Alerting
- [ ] Security alerts configured in Prometheus
- [ ] AlertManager routing configured
- [ ] On-call rotation defined
- [ ] Escalation procedures documented
- [ ] Alert contact information up to date

### SIEM Integration
- [ ] Logs forwarded to SIEM (Splunk, ELK)
- [ ] Security correlation rules enabled
- [ ] Threat hunting dashboards available
- [ ] SIEM retention: 90+ days

---

## Compliance

### OWASP Top 10
- [ ] A01:2021 – Broken Access Control
- [ ] A02:2021 – Cryptographic Failures
- [ ] A03:2021 – Injection
- [ ] A04:2021 – Insecure Design
- [ ] A05:2021 – Security Misconfiguration
- [ ] A06:2021 – Vulnerable and Outdated Components
- [ ] A07:2021 – Identification and Authentication Failures
- [ ] A08:2021 – Software and Data Integrity Failures
- [ ] A09:2021 – Security Logging and Monitoring Failures
- [ ] A10:2021 – Server-Side Request Forgery

### SOC 2 Type II
- [ ] Control environment monitored
- [ ] Communications encrypted
- [ ] Access controls reviewed
- [ ] Vulnerability management program
- [ ] Data backup procedures
- [ ] Incident response plan
- [ ] Compliance audit completed

### ISO 27001
- [ ] Information security policy
- [ ] Risk assessment process
- [ ] Asset management
- [ ] Access control policy
- [ ] Cryptography policy
- [ ] Physical security
- [ ] Compliance audit completed

### GDPR
- [ ] Lawful basis for data processing
- [ ] Data minimization
- [ ] Data subject rights implemented
- [ ] Right to erasure (right to be forgotten)
- [ ] Data portability
- [ ] Data breach notification within 72 hours
- [ ] Privacy by design
- [ ] Data Protection Officer (DPO) appointed

---

## Penetration Testing

### Testing Scope
- [ ] External network penetration testing (quarterly)
- [ ] Internal network penetration testing (annually)
- [ ] Web application penetration testing (quarterly)
- [ ] API penetration testing (quarterly)
- [ ] Social engineering testing (annually)

### Remediation
- [ ] Vulnerabilities tracked and prioritized
- [ ] SLA defined for remediation
  - Critical: 7 days
  - High: 30 days
  - Medium: 90 days
  - Low: 180 days
- [ ] Remediation verified
- [ ] Re-testing performed

---

## Security Training

### Training Programs
- [ ] Security awareness training for all employees (annual)
- [ ] Secure coding training for developers (annual)
- [ ] Phishing simulations (monthly)
- [ ] Compliance training (role-based)

### Certification
- [ ] Developers security certified (e.g., CISSP, CEH)
- [ ] Security team members certified (e.g., OSCP, GCIH)

---

## Review Sign-off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| CISO | | | |
| Security Lead | | | |
| DevOps Lead | | | |
| Engineering Manager | | | |

**Next Review Date**: Quarterly

---

## Quick Reference Commands

### Check for exposed secrets
```bash
grep -r "sk_" --include="*.py" --include="*.yaml" --include="*.json" .
```

### Check for SQL injection risks
```bash
grep -r "execute(" --include="*.py" services/
```

### Check for hardcoded passwords
```bash
grep -r -i "password.*=.*['\"]" --include="*.py" --include="*.yaml" .
```

### Scan container images
```bash
trivy image security-triage/web-dashboard:latest
```

### Check K8s pod security
```bash
kubectl get pods --all-namespaces -o json | jq '.items[] | select(.spec.serviceAccount == null) | .metadata.name'
```

### Check for missing network policies
```bash
kubectl get pods --all-namespaces -l '!network-policy'
```

### Check for vulnerable dependencies
```bash
pip-audit
npm audit
```
