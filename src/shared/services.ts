/**
 * The AWS service manifest — pure data, no React.
 *
 * This module is imported by the serializer, which runs in the Electron main
 * process. Icons live in the renderer (`service-icons.ts`) precisely so that a
 * main-process import never drags a React package across the boundary.
 *
 * The icon is decoration. The `flags` and `reviewProps` are the point: they are
 * what lets the serializer compute a `gaps:` section, and what turns a drawn box
 * into a claim the reviewer can argue with ("RDS" says nothing; "RDS, single-AZ,
 * no backup policy" is a finding).
 *
 * `id` is the canonical token that appears in the serialized design, so it must
 * stay stable — findings reference it.
 */
import type { Category, PropSpec, ServiceFlags } from './types'

export interface ServiceSpec {
  id: string
  name: string
  category: Category
  /** Extra words the palette search should match, for people who think in synonyms. */
  aliases?: string[]
  flags?: ServiceFlags
  reviewProps?: PropSpec[]
}

const MULTI_AZ: PropSpec = { key: 'multi_az', kind: 'bool', label: 'Multi-AZ' }
const BACKUP: PropSpec = { key: 'backup', kind: 'text', label: 'Backup / retention', placeholder: 'e.g. PITR, 7 days' }
const INSTANCE: PropSpec = { key: 'instance_class', kind: 'text', label: 'Instance class', placeholder: 'e.g. db.r6g.large' }
const REPLICAS: PropSpec = { key: 'read_replicas', kind: 'text', label: 'Read replicas', placeholder: 'e.g. 2' }
const AUTOSCALE: PropSpec = { key: 'autoscaling', kind: 'text', label: 'Scaling policy', placeholder: 'e.g. target 60% CPU, 2-20' }
const TLS: PropSpec = { key: 'tls', kind: 'bool', label: 'TLS terminated here' }

export const SERVICES: ServiceSpec[] = [
  // ── Edge ────────────────────────────────────────────────────────────────
  {
    id: 'Route53',
    name: 'Route 53',
    category: 'Edge',
    aliases: ['dns'],
    flags: { entryPoint: true },
    reviewProps: [{ key: 'routing_policy', kind: 'enum', label: 'Routing policy', options: ['simple', 'latency', 'failover', 'weighted', 'geo'] }],
  },
  {
    id: 'CloudFront',
    name: 'CloudFront',
    category: 'Edge',
    aliases: ['cdn', 'edge cache'],
    flags: { entryPoint: true },
    reviewProps: [{ key: 'cache_policy', kind: 'text', label: 'Cache policy', placeholder: 'e.g. 60s TTL on /r/*' }, TLS],
  },
  {
    id: 'WAF',
    name: 'WAF',
    category: 'Security',
    aliases: ['firewall'],
    reviewProps: [{ key: 'rules', kind: 'text', label: 'Rule set', placeholder: 'e.g. rate limit 2000/5min' }],
  },

  // ── Networking ──────────────────────────────────────────────────────────
  {
    id: 'ALB',
    name: 'Application Load Balancer',
    category: 'Networking',
    aliases: ['elb', 'load balancer', 'alb'],
    flags: { entryPoint: true },
    reviewProps: [TLS, { key: 'health_check', kind: 'text', label: 'Health check', placeholder: 'e.g. GET /healthz' }],
  },
  {
    id: 'APIGateway',
    name: 'API Gateway',
    category: 'Networking',
    aliases: ['rest', 'http api'],
    flags: { entryPoint: true },
    reviewProps: [{ key: 'throttle', kind: 'text', label: 'Throttle / quota', placeholder: 'e.g. 10k rps burst 5k' }, { key: 'authorizer', kind: 'text', label: 'Authorizer' }],
  },

  // ── Compute & containers ────────────────────────────────────────────────
  {
    id: 'Lambda',
    name: 'Lambda',
    category: 'Compute',
    aliases: ['serverless', 'function'],
    reviewProps: [
      { key: 'concurrency', kind: 'text', label: 'Concurrency limit', placeholder: 'e.g. reserved 200' },
      { key: 'timeout', kind: 'text', label: 'Timeout', placeholder: 'e.g. 30s' },
    ],
  },
  {
    id: 'EC2',
    name: 'EC2',
    category: 'Compute',
    aliases: ['instance', 'vm', 'server'],
    flags: { needsMultiAz: true, needsScalingPolicy: true },
    reviewProps: [INSTANCE, MULTI_AZ, AUTOSCALE],
  },
  {
    id: 'ECS',
    name: 'ECS',
    category: 'Containers',
    aliases: ['container', 'task', 'service'],
    flags: { needsMultiAz: true, needsScalingPolicy: true },
    reviewProps: [MULTI_AZ, AUTOSCALE, { key: 'launch_type', kind: 'enum', label: 'Launch type', options: ['fargate', 'ec2'] }],
  },
  {
    id: 'Fargate',
    name: 'Fargate',
    category: 'Containers',
    flags: { needsScalingPolicy: true },
    reviewProps: [AUTOSCALE],
  },
  {
    id: 'EKS',
    name: 'EKS',
    category: 'Containers',
    aliases: ['kubernetes', 'k8s'],
    flags: { needsMultiAz: true, needsScalingPolicy: true },
    reviewProps: [MULTI_AZ, AUTOSCALE],
  },

  // ── Databases ───────────────────────────────────────────────────────────
  {
    id: 'RDS',
    name: 'RDS',
    category: 'Database',
    aliases: ['postgres', 'mysql', 'relational', 'sql'],
    flags: { statefulStore: true, needsMultiAz: true, needsBackup: true },
    reviewProps: [
      { key: 'engine', kind: 'enum', label: 'Engine', options: ['postgres', 'mysql', 'mariadb', 'sqlserver', 'oracle'] },
      MULTI_AZ,
      REPLICAS,
      INSTANCE,
      BACKUP,
    ],
  },
  {
    id: 'Aurora',
    name: 'Aurora',
    category: 'Database',
    aliases: ['serverless v2', 'relational'],
    flags: { statefulStore: true, needsMultiAz: true, needsBackup: true },
    reviewProps: [
      { key: 'engine', kind: 'enum', label: 'Engine', options: ['postgres', 'mysql'] },
      MULTI_AZ,
      REPLICAS,
      BACKUP,
    ],
  },
  {
    id: 'DynamoDB',
    name: 'DynamoDB',
    category: 'Database',
    aliases: ['nosql', 'key value', 'ddb'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [
      { key: 'partition_key', kind: 'text', label: 'Partition key', placeholder: 'e.g. short_code' },
      { key: 'capacity', kind: 'enum', label: 'Capacity', options: ['on-demand', 'provisioned'] },
      { key: 'gsi', kind: 'text', label: 'GSIs', placeholder: 'e.g. by_user_id' },
      BACKUP,
    ],
  },
  {
    id: 'ElastiCache',
    name: 'ElastiCache',
    category: 'Database',
    aliases: ['redis', 'memcached', 'cache'],
    flags: { statefulStore: true, needsMultiAz: true },
    reviewProps: [
      { key: 'engine', kind: 'enum', label: 'Engine', options: ['redis', 'memcached'] },
      { key: 'eviction', kind: 'text', label: 'Eviction / TTL', placeholder: 'e.g. allkeys-lru, 1h' },
      MULTI_AZ,
    ],
  },
  {
    id: 'OpenSearch',
    name: 'OpenSearch',
    category: 'Database',
    aliases: ['elasticsearch', 'search'],
    flags: { statefulStore: true, needsMultiAz: true, needsBackup: true },
    reviewProps: [MULTI_AZ, BACKUP],
  },
  {
    id: 'Redshift',
    name: 'Redshift',
    category: 'Analytics',
    aliases: ['warehouse', 'olap'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [BACKUP],
  },

  // ── Storage ─────────────────────────────────────────────────────────────
  {
    id: 'S3',
    name: 'S3',
    category: 'Storage',
    aliases: ['bucket', 'object storage', 'blob'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [
      { key: 'versioning', kind: 'bool', label: 'Versioning' },
      { key: 'lifecycle', kind: 'text', label: 'Lifecycle', placeholder: 'e.g. IA at 30d, Glacier at 90d' },
      { key: 'encryption', kind: 'enum', label: 'Encryption', options: ['SSE-S3', 'SSE-KMS', 'none'] },
    ],
  },
  {
    id: 'EFS',
    name: 'EFS',
    category: 'Storage',
    aliases: ['nfs', 'shared filesystem'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [BACKUP],
  },

  // ── Integration ─────────────────────────────────────────────────────────
  {
    id: 'SQS',
    name: 'SQS',
    category: 'Integration',
    aliases: ['queue', 'buffer'],
    reviewProps: [
      { key: 'dlq', kind: 'bool', label: 'Dead-letter queue' },
      { key: 'fifo', kind: 'bool', label: 'FIFO' },
      { key: 'visibility_timeout', kind: 'text', label: 'Visibility timeout', placeholder: 'e.g. 30s' },
    ],
  },
  {
    id: 'SNS',
    name: 'SNS',
    category: 'Integration',
    aliases: ['pubsub', 'topic', 'fanout'],
    reviewProps: [{ key: 'dlq', kind: 'bool', label: 'Dead-letter queue' }],
  },
  {
    id: 'EventBridge',
    name: 'EventBridge',
    category: 'Integration',
    aliases: ['event bus', 'events'],
    reviewProps: [{ key: 'dlq', kind: 'bool', label: 'Dead-letter queue' }],
  },
  {
    id: 'StepFunctions',
    name: 'Step Functions',
    category: 'Integration',
    aliases: ['workflow', 'orchestration', 'saga'],
    reviewProps: [{ key: 'pattern', kind: 'text', label: 'Pattern', placeholder: 'e.g. saga with compensations' }],
  },
  {
    id: 'Kinesis',
    name: 'Kinesis Data Streams',
    category: 'Analytics',
    aliases: ['stream', 'shard', 'ingest'],
    reviewProps: [
      { key: 'shards', kind: 'text', label: 'Shards', placeholder: 'e.g. 16' },
      { key: 'retention', kind: 'text', label: 'Retention', placeholder: 'e.g. 24h' },
    ],
  },
  { id: 'Glue', name: 'Glue', category: 'Analytics', aliases: ['etl'] },
  { id: 'Athena', name: 'Athena', category: 'Analytics', aliases: ['query', 'sql on s3'] },

  // ── Security & observability ────────────────────────────────────────────
  {
    id: 'Cognito',
    name: 'Cognito',
    category: 'Security',
    aliases: ['auth', 'identity', 'users'],
  },
  {
    id: 'SecretsManager',
    name: 'Secrets Manager',
    category: 'Security',
    aliases: ['secrets', 'credentials'],
    reviewProps: [{ key: 'rotation', kind: 'bool', label: 'Rotation enabled' }],
  },
  {
    id: 'CloudWatch',
    name: 'CloudWatch',
    category: 'Observability',
    aliases: ['metrics', 'logs', 'alarms', 'monitoring'],
    reviewProps: [{ key: 'alarms', kind: 'text', label: 'Alarms', placeholder: 'e.g. p99 > 200ms for 5m' }],
  },
]

const BY_ID = new Map(SERVICES.map((s) => [s.id, s]))

export const getService = (id: string): ServiceSpec | undefined => BY_ID.get(id)

export const CATEGORIES: Category[] = [
  'Edge',
  'Networking',
  'Compute',
  'Containers',
  'Database',
  'Storage',
  'Integration',
  'Analytics',
  'Security',
  'Observability',
]

/** Palette search: name, id and synonyms, so "redis" finds ElastiCache. */
export function searchServices(query: string): ServiceSpec[] {
  const q = query.trim().toLowerCase()
  if (!q) return SERVICES
  return SERVICES.filter((s) =>
    [s.name, s.id, ...(s.aliases ?? [])].some((t) => t.toLowerCase().includes(q)),
  )
}
