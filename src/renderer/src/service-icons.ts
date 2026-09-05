/**
 * Service id -> icon component. Kept apart from the manifest so the serializer
 * (which runs in the main process) never imports React.
 */
import { createAwsIcon, type AwsIconComponent } from '@aws-icons/react'
import {
  AmazonApiGateway,
  AmazonAthena,
  AmazonAurora,
  AmazonCloudFront,
  AmazonCloudWatch,
  AmazonCognito,
  AmazonDynamoDb,
  AmazonEc2,
  AmazonEfs,
  AmazonElastiCache,
  AmazonElasticContainerService,
  AmazonElasticKubernetesService,
  AmazonEventBridge,
  AmazonKinesisDataStreams,
  AmazonOpenSearchService,
  AmazonRds,
  AmazonRedshift,
  AmazonRoute53,
  AmazonSimpleNotificationService,
  AmazonSimpleQueueService,
  AmazonSimpleStorageService,
  AwsFargate,
  AwsGlue,
  AwsLambda,
  AwsSecretsManager,
  AwsStepFunctions,
  AwsWaf,
  ElasticLoadBalancing,
} from '@aws-icons/react/architecture-service'
// Neither of these is a service, so they come from the resource set.
import { GenericApplication, User } from '@aws-icons/react/resource'

export const SERVICE_ICONS: Record<string, AwsIconComponent> = {
  Actor: User,
  Custom: GenericApplication,
  Route53: AmazonRoute53,
  CloudFront: AmazonCloudFront,
  WAF: AwsWaf,
  ALB: ElasticLoadBalancing,
  APIGateway: AmazonApiGateway,
  Lambda: AwsLambda,
  EC2: AmazonEc2,
  ECS: AmazonElasticContainerService,
  Fargate: AwsFargate,
  EKS: AmazonElasticKubernetesService,
  RDS: AmazonRds,
  Aurora: AmazonAurora,
  DynamoDB: AmazonDynamoDb,
  ElastiCache: AmazonElastiCache,
  OpenSearch: AmazonOpenSearchService,
  Redshift: AmazonRedshift,
  S3: AmazonSimpleStorageService,
  EFS: AmazonEfs,
  SQS: AmazonSimpleQueueService,
  SNS: AmazonSimpleNotificationService,
  EventBridge: AmazonEventBridge,
  StepFunctions: AwsStepFunctions,
  Kinesis: AmazonKinesisDataStreams,
  Glue: AwsGlue,
  Athena: AmazonAthena,
  Cognito: AmazonCognito,
  SecretsManager: AwsSecretsManager,
  CloudWatch: AmazonCloudWatch,
}

/**
 * The five that AWS does not ship, drawn here.
 *
 * Built with the icon package's own factory rather than as bare React
 * components, so they carry the same props, the same ref and the same 48-unit
 * viewBox as every generated icon and nothing downstream has to know which is
 * which. `#242f3e` is the ink the AWS resource set uses.
 */
const INK = '#242f3e'
const draw = (name: string, body: string): AwsIconComponent =>
  createAwsIcon(name, { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 48 48' }, body)

/** A page with a folded corner: this is commentary, not a component. */
const NoteIcon = draw(
  'Note',
  `<path fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round" d="M9 5h20l10 10v28H9z"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round" d="M29 5v10h10"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" d="M16 24h16M16 32h11"/>`,
)

/** A header over a dashed line down the page — the shape of a lifeline. */
const LifelineIcon = draw(
  'Lifeline',
  `<rect x="12" y="5" width="24" height="13" rx="2" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<path fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 5" d="M24 20v23"/>`,
)

/** C4 draws its three levels as one shape nested one level deeper each time. */
const C4SystemIcon = draw(
  'C4 System',
  `<rect x="5" y="9" width="38" height="30" rx="3" fill="none" stroke="${INK}" stroke-width="3"/>`,
)
const C4ContainerIcon = draw(
  'C4 Container',
  `<rect x="5" y="9" width="38" height="30" rx="3" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="13" y="17" width="22" height="14" rx="2" fill="none" stroke="${INK}" stroke-width="3"/>`,
)
const C4ComponentIcon = draw(
  'C4 Component',
  `<rect x="5" y="9" width="38" height="30" rx="3" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="11" y="15" width="26" height="18" rx="2" fill="none" stroke="${INK}" stroke-width="3"/>` +
    `<rect x="18" y="21" width="12" height="6" rx="1" fill="${INK}"/>`,
)

Object.assign(SERVICE_ICONS, {
  Note: NoteIcon,
  Lifeline: LifelineIcon,
  C4System: C4SystemIcon,
  C4Container: C4ContainerIcon,
  C4Component: C4ComponentIcon,
})

export const getServiceIcon = (id: string): AwsIconComponent | undefined => SERVICE_ICONS[id]
