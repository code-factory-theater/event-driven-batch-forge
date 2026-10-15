#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BatchProcessingStack } from '../lib/batch-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
};

new BatchProcessingStack(app, 'BatchProcessingStack', {
  env,
  stackName: 'batch-processing-stack',
  description: 'EventBridge + SQS + ECS Fargate batch processing infrastructure',
});

app.synth();