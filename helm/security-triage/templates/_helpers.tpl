# Copyright 2026 CCR <chenchunrun@gmail.com>
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

{{- if .Values.global.environment }}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ include "security-triage.namespace" . }}
  labels:
    name: {{ include "security-triage.namespace" . }}
    app: {{ include "security-triage.fullname" . }}
{{- end }}
---
{{- if .Values.global.environment }}
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: {{ include "security-triage.namespace" . }}
data:
  LOG_LEVEL: {{ .Values.global.logLevel | default "info" | quote }}
  ENVIRONMENT: {{ .Values.global.environment | quote }}
  DATABASE_POOL_SIZE: {{ .Values.global.database.poolSize | default "20" | quote }}
  DB_MAX_OVERFLOW: {{ .Values.global.database.maxOverflow | default "40" | quote }}
{{- end }}
---
{{- if .Values.global.environment }}
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: {{ include "security-triage.namespace" . }}
type: Opaque
stringData:
  DATABASE_URL: {{ .Values.global.database.url | default (printf "postgresql+asyncpg://%s:%s@%s:%d/%s?sslmode=%s" .Values.global.database.user .Values.global.database.password .Values.global.database.host .Values.global.database.port .Values.global.database.name .Values.global.database.sslMode) | quote }}
  REDIS_URL: {{ .Values.global.redis.url | default (printf "redis://:%s@%s:%d/%d" .Values.global.redis.password .Values.global.redis.host .Values.global.redis.port .Values.global.redis.db) | quote }}
  RABBITMQ_URL: {{ .Values.global.rabbitmq.url | default (printf "amqp://%s:%s@%s:%d/%s" .Values.global.rabbitmq.user .Values.global.rabbitmq.password .Values.global.rabbitmq.host .Values.global.rabbitmq.port .Values.global.rabbitmq.vhost) | quote }}
  ENCRYPTION_KEY: {{ .Values.global.encryptionKey | default "CHANGE_ME_GENERATE_STRONG_KEY" | quote }}
  ZHIPU_API_KEY: {{ .Values.global.llm.zhipu.apiKey | default "" | quote }}
  DEEPSEEK_API_KEY: {{ .Values.global.llm.deepseek.apiKey | default "" | quote }}
  QWEN_API_KEY: {{ .Values.global.llm.qwen.apiKey | default "" | quote }}
  OPENAI_API_KEY: {{ .Values.global.llm.openai.apiKey | default "" | quote }}
  VIRUSTOTAL_API_KEY: {{ .Values.global.threatIntel.virustotal.apiKey | default "" | quote }}
  OTX_API_KEY: {{ .Values.global.threatIntel.otx.apiKey | default "" | quote }}
{{- end }}
