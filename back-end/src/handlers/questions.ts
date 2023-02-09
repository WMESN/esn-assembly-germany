///
/// IMPORTS
///

import { DynamoDB, RCError, ResourceController, SES } from 'idea-aws';

import { isEmailInBlockList } from './sesNotifications';

import { Topic } from '../models/topic.model';
import { Question } from '../models/question.model';
import { Answer } from '../models/answer.model';
import { User } from '../models/user.model';

///
/// CONSTANTS, ENVIRONMENT VARIABLES, HANDLER
///

const PROJECT = process.env.PROJECT;
const DDB_TABLES = {
  questions: process.env.DDB_TABLE_questions,
  questionsUpvotes: process.env.DDB_TABLE_questionsUpvotes,
  topics: process.env.DDB_TABLE_topics,
  answers: process.env.DDB_TABLE_answers
};
const ddb = new DynamoDB();

const QUESTION_BASE_URL = `https://${process.env.STAGE === 'prod' ? '' : 'dev.'}esn-ga.link/t/topics/`;
const SES_CONFIG = {
  sourceName: 'ESN General Assembly Q&A',
  source: process.env.SES_SOURCE_ADDRESS,
  sourceArn: process.env.SES_IDENTITY_ARN,
  region: process.env.SES_REGION
};
const ses = new SES();

export const handler = (ev: any, _: any, cb: any): Promise<void> => new Questions(ev, cb).handleRequest();

///
/// RESOURCE CONTROLLER
///

class Questions extends ResourceController {
  galaxyUser: User;
  topic: Topic;
  question: Question;

  constructor(event: any, callback: any) {
    super(event, callback, { resourceId: 'questionId' });
    this.galaxyUser = new User(event.requestContext.authorizer.lambda.user);
  }

  protected async checkAuthBeforeRequest(): Promise<void> {
    try {
      this.topic = new Topic(
        await ddb.get({ TableName: DDB_TABLES.topics, Key: { topicId: this.pathParameters.topicId } })
      );
    } catch (err) {
      throw new RCError('Topic not found');
    }

    if (!this.resourceId) return;

    try {
      this.question = new Question(
        await ddb.get({
          TableName: DDB_TABLES.questions,
          Key: { topicId: this.pathParameters.topicId, questionId: this.resourceId }
        })
      );
    } catch (err) {
      throw new RCError('Question not found');
    }
  }

  protected async getResources(): Promise<Question[]> {
    let questions: Question[] = await ddb.query({
      TableName: DDB_TABLES.questions,
      KeyConditionExpression: 'topicId = :topicId',
      ExpressionAttributeValues: { ':topicId': this.topic.topicId }
    });
    questions = questions.map(x => new Question(x));
    return questions.sort((a, b): number => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  }

  private async putSafeResource(opts: { noOverwrite: boolean }): Promise<Question> {
    const errors = this.question.validate();
    if (errors.length) throw new RCError(`Invalid fields: ${errors.join(', ')}`);

    const putParams: any = { TableName: DDB_TABLES.questions, Item: this.question };
    if (opts.noOverwrite)
      putParams.ConditionExpression = 'attribute_not_exists(topicId) AND attribute_not_exists(questionId)';
    await ddb.put(putParams);

    return this.question;
  }

  protected async postResources(): Promise<Question> {
    if (this.topic.isClosed()) throw new RCError('Topic is closed');
    if (!this.topic.canUserAskQuestions(this.galaxyUser)) throw new Error('Role not allowed to ask questions');

    this.question = new Question(this.body);
    this.question.topicId = this.topic.topicId;
    this.question.questionId = await ddb.IUNID(PROJECT);

    await this.putSafeResource({ noOverwrite: true });

    await this.updateCountersOfTopic();

    await this.sendNotificationToTopicSubjects(this.topic, this.question);

    return this.question;
  }

  protected async getResource(): Promise<Question> {
    return this.question;
  }

  protected async putResource(): Promise<Question> {
    if (!this.question.canUserEdit(this.galaxyUser)) throw new RCError('Unauthorized');

    if (this.topic.isClosed()) throw new RCError('Topic is closed');
    if (await this.questionHasAnswers()) throw new RCError('Question has answers');

    const oldQuestion = new Question(this.question);
    this.question.safeLoad(this.body, oldQuestion);

    return await this.putSafeResource({ noOverwrite: false });
  }

  protected async patchResource(): Promise<Question | { upvoted: boolean }> {
    switch (this.body.action) {
      case 'UPVOTE':
        return await this.upvote();
      case 'UPVOTE_CANCEL':
        return await this.upvote(true);
      case 'IS_UPVOTED':
        return { upvoted: await this.isUpvoted() };
      default:
        throw new RCError('Unsupported action');
    }
  }
  private async upvote(cancel = false): Promise<Question> {
    const upvoteItem = { questionId: this.question.questionId, userId: this.galaxyUser.userId };
    if (cancel) await ddb.delete({ TableName: DDB_TABLES.questionsUpvotes, Key: upvoteItem });
    else await ddb.put({ TableName: DDB_TABLES.questionsUpvotes, Item: upvoteItem });

    this.question.numOfUpvotes = await this.getLiveNumUpvotes();
    await ddb.put({ TableName: DDB_TABLES.questions, Item: this.question });
    return this.question;
  }
  private async getLiveNumUpvotes(): Promise<number> {
    const upvotes = await ddb.query({
      TableName: DDB_TABLES.questionsUpvotes,
      KeyConditionExpression: 'questionId = :questionId',
      ExpressionAttributeValues: { ':questionId': this.question.questionId },
      ConsistentRead: true
    });
    return upvotes.length;
  }
  private async isUpvoted(): Promise<boolean> {
    try {
      const upvoteItem = { questionId: this.question.questionId, userId: this.galaxyUser.userId };
      await ddb.get({ TableName: DDB_TABLES.questionsUpvotes, Key: upvoteItem });
      return true;
    } catch (error) {
      return false;
    }
  }

  protected async deleteResource(): Promise<void> {
    if (!this.question.canUserEdit(this.galaxyUser)) throw new RCError('Unauthorized');

    if (this.topic.isClosed()) throw new RCError('Topic is closed');
    if (await this.questionHasAnswers()) throw new RCError('Question has answers');

    await ddb.delete({
      TableName: DDB_TABLES.questions,
      Key: { topicId: this.topic.topicId, questionId: this.question.questionId }
    });

    await this.updateCountersOfTopic();
  }

  private async questionHasAnswers(): Promise<boolean> {
    const answersToQuestion: Answer[] = await ddb.query({
      TableName: DDB_TABLES.answers,
      KeyConditionExpression: 'questionId = :questionId',
      ExpressionAttributeValues: { ':questionId': this.question.questionId }
    });
    return answersToQuestion.length > 0;
  }
  private async updateCountersOfTopic(): Promise<void> {
    try {
      const questionsOfTopic = await this.getResources();

      await ddb.update({
        TableName: DDB_TABLES.topics,
        Key: { topicId: this.topic.topicId },
        UpdateExpression: 'SET numOfQuestions = :num',
        ExpressionAttributeValues: { ':num': questionsOfTopic.length }
      });
    } catch (error) {
      this.logger.warn('Counters not updated', error, { topicId: this.topic.topicId });
    }
  }

  private async sendNotificationToTopicSubjects(topic: Topic, question: Question): Promise<void> {
    const subjectsToNotify = topic.subjects.filter(x => !!x.email);
    const template = 'notify-new-question';
    for (const subject of subjectsToNotify) {
      const templateData = {
        userName: subject.name,
        topic: topic.name,
        question: question.summary,
        url: QUESTION_BASE_URL.concat(topic.topicId)
      };
      if (!(await isEmailInBlockList(question.creator.email)))
        await ses.sendTemplatedEmail({ toAddresses: [subject.email], template, templateData }, SES_CONFIG);
    }
  }
}
