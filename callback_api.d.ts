import events = require('events');
import {
  ChannelOptions,
  ConsumeMessage,
  GetMessage,
  Message,
  Options,
  Replies,
  ServerProperties,
  SocketOptions,
} from './lib/properties';
export * from './lib/properties';

export interface Connection extends events.EventEmitter {
  close(callback?: (err: any) => void): void;
  createChannel(callback: (err: any, channel: Channel) => void): Channel;
  createChannel(options: ChannelOptions, callback: (err: any, channel: Channel) => void): Channel;
  createConfirmChannel(callback: (err: any, confirmChannel: ConfirmChannel) => void): ConfirmChannel;
  createConfirmChannel(options: ChannelOptions, callback: (err: any, confirmChannel: ConfirmChannel) => void): ConfirmChannel;
  readonly connection: {
    readonly serverProperties: ServerProperties;
  };
  updateSecret(newSecret: Buffer, reason: string, callback?: (err: any) => void): void;
}

export interface Channel extends events.EventEmitter {
  readonly connection: Connection;

  close(callback?: (err: any) => void): void;

  assertQueue(queue?: string, options?: Options.AssertQueue, callback?: (err: any, ok: Replies.AssertQueue) => void): void;
  checkQueue(queue: string, callback?: (err: any, ok: Replies.AssertQueue) => void): void;

  deleteQueue(queue: string, options?: Options.DeleteQueue, callback?: (err: any, ok: Replies.DeleteQueue) => void): void;
  purgeQueue(queue: string, callback?: (err: any, ok: Replies.PurgeQueue) => void): void;

  bindQueue(
    queue: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: any, ok: Replies.Empty) => void,
  ): void;
  unbindQueue(
    queue: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: any, ok: Replies.Empty) => void,
  ): void;

  assertExchange(
    exchange: string,
    type: 'direct' | 'topic' | 'headers' | 'fanout' | 'match' | string,
    options?: Options.AssertExchange,
    callback?: (err: any, ok: Replies.AssertExchange) => void,
  ): void;
  checkExchange(exchange: string, callback?: (err: any, ok: Replies.Empty) => void): void;

  deleteExchange(exchange: string, options?: Options.DeleteExchange, callback?: (err: any, ok: Replies.Empty) => void): void;

  bindExchange(
    destination: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: any, ok: Replies.Empty) => void,
  ): void;
  unbindExchange(
    destination: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: any, ok: Replies.Empty) => void,
  ): void;

  publish(exchange: string, routingKey: string, content: Buffer, options?: Options.Publish): boolean;
  sendToQueue(queue: string, content: Buffer, options?: Options.Publish): boolean;

  consume(
    queue: string,
    onMessage: (msg: ConsumeMessage | null) => void,
    options?: Options.Consume,
    callback?: (err: any, ok: Replies.Consume) => void,
  ): void;

  cancel(consumerTag: string, callback?: (err: any, ok: Replies.Empty) => void): void;
  get(queue: string, options?: Options.Get, callback?: (err: any, ok: GetMessage | false) => void): void;

  ack(message: Message, allUpTo?: boolean): void;
  ackAll(): void;

  nack(message: Message, allUpTo?: boolean, requeue?: boolean): void;
  nackAll(requeue?: boolean): void;
  reject(message: Message, requeue?: boolean): void;

  prefetch(count: number, global?: boolean, callback?: (err: any, ok: Replies.Empty) => void): void;
  recover(callback?: (err: any, ok: Replies.Empty) => void): void;
}

export interface ConfirmChannel extends Channel {
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: Options.Publish,
    callback?: (err: any, ok: Replies.Empty) => void,
  ): boolean;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: Options.Publish,
    callback?: (err: any, ok: Replies.Empty) => void,
  ): boolean;

  waitForConfirms(callback?: (err?: Error) => void): void;
}

export declare class IllegalOperationError extends Error {
  name: 'IllegalOperationError';
  stackAtStateChange: string | undefined;
  constructor(msg: string, stack?: string);
}

export declare const credentials: {
  plain(username: string, password: string): {
    mechanism: string;
    response(): Buffer;
    username: string;
    password: string;
  };
  amqplain(username: string, password: string): {
    mechanism: string;
    response(): Buffer;
    username: string;
    password: string;
  };
  external(): {
    mechanism: string;
    response(): Buffer;
  };
};

export declare function connect(callback: (err: any, connection: Connection) => void): void;
export declare function connect(url: string | Options.Connect, callback: (err: any, connection: Connection) => void): void;
export declare function connect(
  url: string | Options.Connect,
  socketOptions: SocketOptions,
  callback: (err: any, connection: Connection) => void,
): void;
