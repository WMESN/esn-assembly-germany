#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as DDB from 'aws-cdk-lib/aws-dynamodb';

import { IDEAStack } from './idea-stack';
import { MediaStack } from './media-stack';
import { ApiDomainStack } from './api-domain-stack';
import { ResourceController, ApiStack, DDBTable } from './api-stack';
import { FrontEndStack } from './front-end-stack';

import { parameters, stages, Stage } from './environments';

//
// RESOURCES
//

const apiResources: ResourceController[] = [
  { name: 'auth', isAuthFunction: true },
  { name: 'login', paths: ['/login'] },
  { name: 'categories', paths: ['/categories', '/categories/{categoryId}'] },
  { name: 'events', paths: ['/events', '/events/{eventId}'] }
];

const tables: { [tableName: string]: DDBTable } = {
  categories: {
    PK: { name: 'categoryId', type: DDB.AttributeType.STRING }
  },
  events: {
    PK: { name: 'eventId', type: DDB.AttributeType.STRING }
  }
};

//
// STACKS
//

const createApp = async (): Promise<void> => {
  const app = new cdk.App({});

  const env = { account: parameters.awsAccount, region: parameters.awsRegion };

  const STAGE = app.node.tryGetContext('stage');
  const STAGE_VARIABLES = (stages as any)[STAGE] as Stage;
  if (!STAGE_VARIABLES) {
    console.log('Missing stage (environments.ts); e.g. --parameters stage=dev\n\n');
    throw new Error();
  }

  //
  // GENERIC RESOURCES (they don't depend by the stage)
  //

  new IDEAStack(app, `idea-resources`);

  const mediaStack = new MediaStack(app, `${parameters.project}-media`, {
    env,
    mediaBucketName: `${parameters.project}-media`,
    mediaDomain: parameters.mediaDomain
  });

  const apiDomainStack = new ApiDomainStack(app, `${parameters.project}-api-domain`, {
    env,
    domain: parameters.apiDomain
  });

  //
  // STAGE-DEPENDANT RESOURCES
  //

  const apiStack = new ApiStack(app, `${parameters.project}-${STAGE}-api`, {
    env,
    project: parameters.project,
    stage: STAGE,
    firstAdminEmail: parameters.firstAdminEmail,
    apiDomain: parameters.apiDomain,
    apiDefinitionFile: './swagger.yaml',
    resourceControllers: apiResources,
    tables,
    mediaBucketArn: mediaStack.mediaBucketArn,
    removalPolicy: STAGE_VARIABLES.destroyDataOnDelete ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN
  });
  apiStack.addDependency(mediaStack);
  apiStack.addDependency(apiDomainStack);

  new FrontEndStack(app, `${parameters.project}-${STAGE}-front-end`, {
    env,
    project: parameters.project,
    stage: STAGE,
    domain: STAGE_VARIABLES.domain
  });
};
createApp();
