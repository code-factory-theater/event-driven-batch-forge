import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as alarms from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class BatchProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Retrieve Terraform-managed resources from SSM
    const vpcId = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/vpc-id');
    const privateSubnetIds = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/private-subnet-ids').split(',');
    const ecsClusterArn = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/ecs-cluster-arn');
    const cwLogGroupName = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/cloudwatch-log-group-name');
    const ecrRepoUri = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/ecr-repository-uri');
    const taskExecutionRoleArn = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/ecs-task-execution-role-arn');
    const taskRoleArn = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/ecs-task-role-arn');
    const sgId = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/ecs-security-group-id');
    const kmsKeyArn = ssm.StringParameter.valueForStringParameter(this, '/batch/terraform/kms-key-arn');

    const region = this.region;
    const account = this.account;

    // SNS Topic for DLQ alerts
    const dlqAlertTopic = new sns.Topic(this, 'DLQAlertTopic', {
      displayName: 'Batch Processing DLQ Alerts',
    });

    // SQS Dead Letter Queue
    const dlq = new sqs.Queue(this, 'BatchDLQ', {
      queueName: 'batch-processing-dlq',
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: cdk.aws_kms.Key.fromKeyArn(this, 'KmsKey', kmsKeyArn),
      enforceSSL: true,
    });

    // SQS Main Queue with DLQ
    const queue = new sqs.Queue(this, 'BatchQueue', {
      queueName: 'batch-processing-queue',
      visibilityTimeout: cdk.Duration.seconds(300),
      messageRetentionPeriod: cdk.Duration.days(14),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: cdk.aws_kms.Key.fromKeyArn(this, 'KmsKeyQueue', kmsKeyArn),
      enforceSSL: true,
    });

    // DLQ monitoring alarm
    const dlqAlarm = new cloudwatch.Alarm(this, 'DLQMessageAlarm', {
      metric: dlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 0,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when messages appear in DLQ',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new alarms.SnsAction(dlqAlertTopic));

    // EventBridge Rule - Daily scheduled execution
    const dailyRule = new events.Rule(this, 'DailyBatchRule', {
      schedule: events.Schedule.cron({ hour: '2', minute: '0', day: '*', month: '*', year: '*' }),
      description: 'Trigger batch processing daily at 2 AM UTC',
    });

    dailyRule.addTarget(new targets.SqsQueue(queue, {
      message: events.RuleTargetInput.fromObject({
        triggerSource: 'scheduled',
        timestamp: events.EventField.fromPath('$.time'),
      }),
    }));

    // EventBridge Rule - Webhook pattern (example: external event)
    const webhookRule = new events.Rule(this, 'WebhookBatchRule', {
      eventPattern: {
        source: ['custom.batch'],
        detailType: ['ProcessingRequest'],
      },
      description: 'Trigger batch processing on webhook event',
    });

    webhookRule.addTarget(new targets.SqsQueue(queue, {
      message: events.RuleTargetInput.fromObject({
        triggerSource: 'webhook',
        detail: events.EventField.fromPath('$.detail'),
      }),
    }));

    // ECS Cluster reference
    const cluster = ecs.Cluster.fromClusterAttributes(this, 'BatchCluster', {
      clusterName: ecsClusterArn.split('/').pop() || 'batch-cluster',
      vpc: cdk.aws_ec2.Vpc.fromLookup(this, 'VPC', { vpcId }),
    });

    // ECS Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'BatchTaskDef', {
      memoryLimitMiB: 1024,
      cpu: 512,
      executionRole: iam.Role.fromRoleArn(this, 'TaskExecRole', taskExecutionRoleArn, { mutable: false }),
      taskRole: iam.Role.fromRoleArn(this, 'TaskRole', taskRoleArn, { mutable: false }),
    });

    const container = taskDefinition.addContainer('BatchContainer', {
      image: ecs.ContainerImage.fromRegistry(ecrRepoUri + ':latest'),
      logging: ecs.LogDriver.awsLogs({
        logGroup: cdk.aws_logs.LogGroup.fromLogGroupName(this, 'LogGroup', cwLogGroupName),
        streamPrefix: 'batch',
      }),
      environment: {
        QUEUE_URL: queue.queueUrl,
        AWS_REGION: region,
      },
    });

    // EventBridge Rule - SQS to ECS (poll-based trigger via CloudWatch Events)
    // Note: For production, use EventBridge Pipe or Lambda to trigger Fargate tasks
    const ecsRunTaskTarget = new targets.EcsTask({
      cluster,
      taskDefinition,
      assignPublicIp: false,
      containerOverrides: [
        {
          containerName: 'BatchContainer',
          environment: [
            { name: 'QUEUE_URL', value: queue.queueUrl },
          ],
        },
      ],
      taskCount: 1,
    });

    const pollingRule = new events.Rule(this, 'PollingTriggerRule', {
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      description: 'Trigger ECS task polling every 5 minutes',
    });
    pollingRule.addTarget(ecsRunTaskTarget);

    // CloudWatch Metrics
    const queueDepthMetric = queue.metricApproximateNumberOfMessagesVisible({
      statistic: 'Average',
    });

    const queueDepthAlarm = new cloudwatch.Alarm(this, 'QueueDepthAlarm', {
      metric: queueDepthMetric,
      threshold: 100,
      evaluationPeriods: 2,
      alarmDescription: 'Alert when queue depth exceeds 100 messages',
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    queueDepthAlarm.addAlarmAction(new alarms.SnsAction(dlqAlertTopic));

    // Outputs
    new cdk.CfnOutput(this, 'QueueUrl', {
      value: queue.queueUrl,
      description: 'SQS Queue URL',
      exportName: 'BatchQueueUrl',
    });

    new cdk.CfnOutput(this, 'DLQUrl', {
      value: dlq.queueUrl,
      description: 'SQS Dead Letter Queue URL',
      exportName: 'BatchDLQUrl',
    });

    new cdk.CfnOutput(this, 'SNSTopicArn', {
      value: dlqAlertTopic.topicArn,
      description: 'SNS Topic for DLQ Alerts',
      exportName: 'BatchAlertTopicArn',
    });
  }
}