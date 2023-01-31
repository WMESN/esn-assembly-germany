import { Injectable } from '@angular/core';
import { IDEAApiService } from '@idea-ionic/common';

import { Topic } from '@models/topic.model';

@Injectable({ providedIn: 'root' })
export class TopicsService {
  private topics: Topic[];

  /**
   * The number of topics to consider for the pagination, when active.
   */
  MAX_PAGE_SIZE = 24;

  constructor(private api: IDEAApiService) {}

  /**
   * Load the tems from the back-end.
   */
  private async loadList(): Promise<void> {
    const topics: Topic[] = await this.api.getResource('topics');
    this.topics = topics.map(x => new Topic(x));
  }
  /**
   * Get (and optionally filter) the list of topics.
   * Note: it's a slice of the array.
   */
  async getList(
    options: {
      force?: boolean;
      search?: string;
      categoryId?: string;
      eventId?: string;
      withPagination?: boolean;
      startPaginationAfterId?: string;
      sortBy?: TopicsSortBy;
    } = { sortBy: TopicsSortBy.CREATED_DATE_DESC }
  ): Promise<Topic[]> {
    if (!this.topics || options.force) await this.loadList();
    if (!this.topics) return null;

    options.search = options.search ? String(options.search).toLowerCase() : '';

    let filteredList = this.topics.slice();

    if (options.search)
      filteredList = filteredList.filter(x =>
        options.search
          .split(' ')
          .every(searchTerm => [x.name].filter(f => f).some(f => f.toLowerCase().includes(searchTerm)))
      );

    if (options.categoryId) filteredList = filteredList.filter(x => x.category.categoryId === options.categoryId);

    if (options.eventId) filteredList = filteredList.filter(x => x.event.eventId === options.eventId);

    switch (options.sortBy) {
      case TopicsSortBy.CREATED_DATE_ASC:
        filteredList = filteredList.sort((a, b): number => a.createdAt.localeCompare(b.createdAt));
        break;
      case TopicsSortBy.CREATED_DATE_DESC:
        filteredList = filteredList.sort((a, b): number => b.createdAt.localeCompare(a.createdAt));
        break;
      case TopicsSortBy.UPDATED_DATE_ASC:
        filteredList = filteredList.sort((a, b): number => a.updatedAt.localeCompare(b.updatedAt));
        break;
      case TopicsSortBy.CREATED_DATE_DESC:
        filteredList = filteredList.sort((a, b): number => b.updatedAt.localeCompare(a.updatedAt));
        break;
      case TopicsSortBy.NUM_OF_QUESTIONS_ASC:
        filteredList = filteredList.sort((a, b): number => a.numOfQuestions - b.numOfQuestions);
        break;
      case TopicsSortBy.NUM_OF_QUESTIONS_DESC:
        filteredList = filteredList.sort((a, b): number => b.numOfQuestions - a.numOfQuestions);
        break;
    }

    if (options.withPagination && filteredList.length > this.MAX_PAGE_SIZE) {
      let indexOfLastOfPreviousPage = 0;
      if (options.startPaginationAfterId)
        indexOfLastOfPreviousPage = filteredList.findIndex(x => x.topicId === options.startPaginationAfterId) || 0;
      filteredList = filteredList.slice(0, indexOfLastOfPreviousPage + this.MAX_PAGE_SIZE);
    }

    return filteredList;
  }

  /**
   * Get a topic by its id.
   */
  async getById(topicId: string): Promise<Topic> {
    return new Topic(await this.api.getResource(['topics', topicId]));
  }

  /**
   * Insert a topic.
   */
  async insert(topic: Topic): Promise<Topic> {
    return new Topic(await this.api.postResource('topics', { body: topic }));
  }

  /**
   * Update a topic.
   */
  async update(topic: Topic): Promise<Topic> {
    return new Topic(await this.api.putResource(['topics', topic.topicId], { body: topic }));
  }

  /**
   * Open a topic.
   */
  async open(topic: Topic): Promise<void> {
    await this.api.patchResource(['topics', topic.topicId], { body: { action: 'OPEN' } });
  }
  /**
   * Close a topic.
   */
  async close(topic: Topic): Promise<void> {
    await this.api.patchResource(['topics', topic.topicId], { body: { action: 'CLOSE' } });
  }

  /**
   * Archive a topic.
   */
  async archive(topic: Topic): Promise<void> {
    await this.api.patchResource(['topics', topic.topicId], { body: { action: 'ARCHIVE' } });
  }
  /**
   * Unarchive a topic.
   */
  async unarchive(topic: Topic): Promise<void> {
    await this.api.patchResource(['topics', topic.topicId], { body: { action: 'UNARCHIVE' } });
  }

  /**
   * Delete a topic.
   */
  async delete(event: Topic): Promise<void> {
    await this.api.deleteResource(['topics', event.topicId]);
  }
}

/**
 * The possible sorting mechanisms for the topics.
 */
export enum TopicsSortBy {
  CREATED_DATE_ASC = 'CREATED_DATE_ASC',
  CREATED_DATE_DESC = 'CREATED_DATE_DESC',
  UPDATED_DATE_ASC = 'UPDATED_DATE_ASC',
  UPDATED_DATE_DESC = 'UPDATED_DATE_DESC',
  NUM_OF_QUESTIONS_ASC = 'NUM_OF_QUESTIONS_ASC',
  NUM_OF_QUESTIONS_DESC = 'NUM_OF_QUESTIONS_DESC'
}
