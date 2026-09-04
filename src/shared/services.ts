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

/** Shared so one property means one thing across every service. */
const MULTI_AZ: PropSpec = { key: 'multi_az', kind: 'bool' }
const BACKUP: PropSpec = { key: 'backup', kind: 'text' }
const INSTANCE: PropSpec = { key: 'instance_class', kind: 'text' }
const REPLICAS: PropSpec = { key: 'read_replicas', kind: 'text' }
const AUTOSCALE: PropSpec = { key: 'autoscaling', kind: 'text' }
const TLS: PropSpec = { key: 'tls', kind: 'bool' }

export const SERVICES: ServiceSpec[] = [
  // ── Edge ────────────────────────────────────────────────────────────────
  {
    id: 'Route53',
    name: 'Route 53',
    category: 'Edge',
    aliases: ['dns', 'dominio'],
    flags: { entryPoint: true },
    reviewProps: [{ key: 'routing_policy', kind: 'enum', options: ['simple', 'latency', 'failover', 'weighted', 'geo'] }],
  },
  {
    id: 'CloudFront',
    name: 'CloudFront',
    category: 'Edge',
    aliases: ['cdn', 'edge cache', 'caché de borde', 'red de entrega'],
    flags: { entryPoint: true },
    reviewProps: [{ key: 'cache_policy', kind: 'text' }, TLS],
  },
  {
    id: 'WAF',
    name: 'WAF',
    category: 'Security',
    aliases: ['firewall', 'cortafuegos'],
    reviewProps: [{ key: 'rules', kind: 'text' }],
  },

  // ── Networking ──────────────────────────────────────────────────────────
  {
    id: 'ALB',
    name: 'Application Load Balancer',
    category: 'Networking',
    aliases: ['elb', 'load balancer', 'alb', 'balanceador', 'balanceo de carga'],
    flags: { entryPoint: true },
    reviewProps: [TLS, { key: 'health_check', kind: 'text' }],
  },
  {
    id: 'APIGateway',
    name: 'API Gateway',
    category: 'Networking',
    aliases: ['rest', 'http api', 'api', 'pasarela'],
    flags: { entryPoint: true },
    reviewProps: [{ key: 'throttle', kind: 'text' }, { key: 'authorizer', kind: 'text' }],
  },

  // ── Compute & containers ────────────────────────────────────────────────
  {
    id: 'Lambda',
    name: 'Lambda',
    category: 'Compute',
    aliases: ['serverless', 'function', 'sin servidor', 'función'],
    reviewProps: [
      { key: 'concurrency', kind: 'text' },
      { key: 'timeout', kind: 'text' },
    ],
  },
  {
    id: 'EC2',
    name: 'EC2',
    category: 'Compute',
    aliases: ['instance', 'vm', 'server', 'instancia', 'servidor', 'máquina virtual'],
    flags: { needsMultiAz: true, needsScalingPolicy: true },
    reviewProps: [INSTANCE, MULTI_AZ, AUTOSCALE],
  },
  {
    id: 'ECS',
    name: 'ECS',
    category: 'Containers',
    aliases: ['container', 'task', 'service', 'contenedor', 'tarea', 'servicio'],
    flags: { needsMultiAz: true, needsScalingPolicy: true },
    reviewProps: [MULTI_AZ, AUTOSCALE, { key: 'launch_type', kind: 'enum', options: ['fargate', 'ec2'] }],
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
    aliases: ['postgres', 'mysql', 'relational', 'sql', 'base de datos', 'relacional'],
    flags: { statefulStore: true, needsMultiAz: true, needsBackup: true },
    reviewProps: [
      { key: 'engine', kind: 'enum', options: ['postgres', 'mysql', 'mariadb', 'sqlserver', 'oracle'] },
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
    aliases: ['serverless v2', 'relational', 'relacional', 'base de datos'],
    flags: { statefulStore: true, needsMultiAz: true, needsBackup: true },
    reviewProps: [
      { key: 'engine', kind: 'enum', options: ['postgres', 'mysql'] },
      MULTI_AZ,
      REPLICAS,
      BACKUP,
    ],
  },
  {
    id: 'DynamoDB',
    name: 'DynamoDB',
    category: 'Database',
    aliases: ['nosql', 'key value', 'ddb', 'clave valor', 'llave valor'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [
      { key: 'partition_key', kind: 'text' },
      { key: 'capacity', kind: 'enum', options: ['on-demand', 'provisioned'] },
      { key: 'gsi', kind: 'text' },
      BACKUP,
    ],
  },
  {
    id: 'ElastiCache',
    name: 'ElastiCache',
    category: 'Database',
    aliases: ['redis', 'memcached', 'cache', 'caché', 'memoria'],
    flags: { statefulStore: true, needsMultiAz: true },
    reviewProps: [
      { key: 'engine', kind: 'enum', options: ['redis', 'memcached'] },
      { key: 'eviction', kind: 'text' },
      MULTI_AZ,
    ],
  },
  {
    id: 'OpenSearch',
    name: 'OpenSearch',
    category: 'Database',
    aliases: ['elasticsearch', 'search', 'búsqueda', 'buscador'],
    flags: { statefulStore: true, needsMultiAz: true, needsBackup: true },
    reviewProps: [MULTI_AZ, BACKUP],
  },
  {
    id: 'Redshift',
    name: 'Redshift',
    category: 'Analytics',
    aliases: ['warehouse', 'olap', 'almacén de datos'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [BACKUP],
  },

  // ── Storage ─────────────────────────────────────────────────────────────
  {
    id: 'S3',
    name: 'S3',
    category: 'Storage',
    aliases: ['bucket', 'object storage', 'blob', 'almacenamiento', 'objetos', 'archivos'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [
      { key: 'versioning', kind: 'bool' },
      { key: 'lifecycle', kind: 'text' },
      { key: 'encryption', kind: 'enum', options: ['SSE-S3', 'SSE-KMS', 'none'] },
    ],
  },
  {
    id: 'EFS',
    name: 'EFS',
    category: 'Storage',
    aliases: ['nfs', 'shared filesystem', 'archivos compartidos', 'sistema de archivos'],
    flags: { statefulStore: true, needsBackup: true },
    reviewProps: [BACKUP],
  },

  // ── Integration ─────────────────────────────────────────────────────────
  {
    id: 'SQS',
    name: 'SQS',
    category: 'Integration',
    aliases: ['queue', 'buffer', 'cola', 'mensajes'],
    reviewProps: [
      { key: 'dlq', kind: 'bool' },
      { key: 'fifo', kind: 'bool' },
      { key: 'visibility_timeout', kind: 'text' },
    ],
  },
  {
    id: 'SNS',
    name: 'SNS',
    category: 'Integration',
    aliases: ['pubsub', 'topic', 'fanout', 'notificaciones', 'tema'],
    reviewProps: [{ key: 'dlq', kind: 'bool' }],
  },
  {
    id: 'EventBridge',
    name: 'EventBridge',
    category: 'Integration',
    aliases: ['event bus', 'events', 'eventos', 'bus de eventos'],
    reviewProps: [{ key: 'dlq', kind: 'bool' }],
  },
  {
    id: 'StepFunctions',
    name: 'Step Functions',
    category: 'Integration',
    aliases: ['workflow', 'orchestration', 'saga', 'flujo', 'orquestación'],
    reviewProps: [{ key: 'pattern', kind: 'text' }],
  },
  {
    id: 'Kinesis',
    name: 'Kinesis Data Streams',
    category: 'Analytics',
    aliases: ['stream', 'shard', 'ingest', 'flujo', 'ingesta', 'streaming'],
    reviewProps: [
      { key: 'shards', kind: 'text' },
      { key: 'retention', kind: 'text' },
    ],
  },
  { id: 'Glue', name: 'Glue', category: 'Analytics', aliases: ['etl', 'transformación'] },
  { id: 'Athena', name: 'Athena', category: 'Analytics', aliases: ['query', 'sql on s3', 'consultas'] },

  // ── Security & observability ────────────────────────────────────────────
  {
    id: 'Cognito',
    name: 'Cognito',
    category: 'Security',
    aliases: ['auth', 'identity', 'users', 'autenticación', 'identidad', 'usuarios'],
  },
  {
    id: 'SecretsManager',
    name: 'Secrets Manager',
    category: 'Security',
    aliases: ['secrets', 'credentials', 'secretos', 'credenciales'],
    reviewProps: [{ key: 'rotation', kind: 'bool' }],
  },
  {
    id: 'CloudWatch',
    name: 'CloudWatch',
    category: 'Observability',
    aliases: ['metrics', 'logs', 'alarms', 'monitoring', 'métricas', 'registros', 'alarmas', 'monitoreo'],
    reviewProps: [{ key: 'alarms', kind: 'text' }],
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

/**
 * Palette search: name, id and synonyms in both languages, so "redis" and
 * "caché" both find ElastiCache. Accents are folded, because nobody reaches for
 * the accent key mid-search.
 */
const fold = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export function searchServices(query: string): ServiceSpec[] {
  const q = fold(query.trim())
  if (!q) return SERVICES
  return SERVICES.filter((s) => [s.name, s.id, ...(s.aliases ?? [])].some((t) => fold(t).includes(q)))
}
