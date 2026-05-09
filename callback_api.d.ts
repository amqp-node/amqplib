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
  close(callback?: (err: Error) => void): void;
  createChannel(callback: (err: Error, channel: Channel) => void): Channel;
  createChannel(options: ChannelOptions, callback: (err: Error, channel: Channel) => void): Channel;
  createConfirmChannel(callback: (err: Error, confirmChannel: ConfirmChannel) => void): ConfirmChannel;
  createConfirmChannel(options: ChannelOptions, callback: (err: Error, confirmChannel: ConfirmChannel) => void): ConfirmChannel;
  readonly connection: {
    readonly serverProperties: ServerProperties;
  };
  updateSecret(newSecret: Buffer, reason: string, callback?: (err: Error) => void): void;

  on(event: 'close', listener: (err?: Error) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'blocked', listener: (reason: string) => void): this;
  on(event: 'unblocked', listener: () => void): this;
  on(event: 'update-secret-ok', listener: () => void): this;
  on(event: 'handler-error', listener: (err: Error, eventName: string) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export interface Channel extends events.EventEmitter {
  readonly connection: Connection;

  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'drain', listener: () => void): this;
  on(event: 'ack', listener: (fields: { deliveryTag: number; multiple: boolean }) => void): this;
  on(event: 'nack', listener: (fields: { deliveryTag: number; multiple: boolean; requeue: boolean }) => void): this;
  on(event: 'cancel', listener: (fields: { consumerTag: string }) => void): this;
  on(event: 'delivery', listener: (message: ConsumeMessage) => void): this;
  on(event: 'return', listener: (message: Message) => void): this;
  on(event: 'handler-error', listener: (err: Error, eventName: string) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;

  close(callback?: (err: Error) => void): void;

  assertQueue(queue?: string, options?: Options.AssertQueue, callback?: (err: Error, ok: Replies.AssertQueue) => void): void;
  checkQueue(queue: string, callback?: (err: Error, ok: Replies.AssertQueue) => void): void;

  deleteQueue(queue: string, options?: Options.DeleteQueue, callback?: (err: Error, ok: Replies.DeleteQueue) => void): void;
  purgeQueue(queue: string, callback?: (err: Error, ok: Replies.PurgeQueue) => void): void;

  bindQueue(
    queue: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: Error, ok: Replies.Empty) => void,
  ): void;
  unbindQueue(
    queue: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: Error, ok: Replies.Empty) => void,
  ): void;

  assertExchange(
    exchange: string,
    type: 'direct' | 'topic' | 'headers' | 'fanout' | 'match' | string,
    options?: Options.AssertExchange,
    callback?: (err: Error, ok: Replies.AssertExchange) => void,
  ): void;
  checkExchange(exchange: string, callback?: (err: Error, ok: Replies.Empty) => void): void;

  deleteExchange(exchange: string, options?: Options.DeleteExchange, callback?: (err: Error, ok: Replies.Empty) => void): void;

  bindExchange(
    destination: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: Error, ok: Replies.Empty) => void,
  ): void;
  unbindExchange(
    destination: string,
    source: string,
    pattern: string,
    args?: any,
    callback?: (err: Error, ok: Replies.Empty) => void,
  ): void;

  publish(exchange: string, routingKey: string, content: Buffer, options?: Options.Publish): boolean;
  sendToQueue(queue: string, content: Buffer, options?: Options.Publish): boolean;

  consume(
    queue: string,
    onMessage: (msg: ConsumeMessage | null) => void,
    options?: Options.Consume,
    callback?: (err: Error, ok: Replies.Consume) => void,
  ): void;

  cancel(consumerTag: string, callback?: (err: Error, ok: Replies.Empty) => void): void;
  get(queue: string, options?: Options.Get, callback?: (err: Error, ok: GetMessage | false) => void): void;

  ack(message: Message, allUpTo?: boolean): void;
  ackAll(): void;

  nack(message: Message, allUpTo?: boolean, requeue?: boolean): void;
  nackAll(requeue?: boolean): void;
  reject(message: Message, requeue?: boolean): void;

  prefetch(count: number, global?: boolean, callback?: (err: Error, ok: Replies.Empty) => void): void;
  recover(callback?: (err: Error, ok: Replies.Empty) => void): void;
}

export interface ConfirmChannel extends Channel {
  publish(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options?: Options.Publish,
    callback?: (err: Error, ok: Replies.Empty) => void,
  ): boolean;
  sendToQueue(
    queue: string,
    content: Buffer,
    options?: Options.Publish,
    callback?: (err: Error, ok: Replies.Empty) => void,
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

export interface RecoveryOptions {
  /** Initial reconnect delay in milliseconds. Default: 100 */
  initialDelay?: number;
  /** Maximum reconnect delay in milliseconds. Default: 30000 */
  maxDelay?: number;
  /** Backoff multiplier applied to delay on each attempt. Default: 2 */
  factor?: number;
  /** Jitter factor (0–1) applied to delay to avoid thundering herd. Default: 0.2 */
  jitter?: number;
  /** Maximum number of reconnect attempts. Default: Infinity */
  maxRetries?: number;
  /** Optional setup function called after each successful connection */
  setup?: ((model: Connection) => Promise<void>) | ((model: Connection, done: (err?: Error) => void) => void);
}

export interface RecoveringConnection extends events.EventEmitter {
  close(callback?: (err: Error) => void): void;
  createChannel(callback: (err: Error, channel: Channel) => void): Channel;
  createChannel(options: ChannelOptions, callback: (err: Error, channel: Channel) => void): Channel;
  createConfirmChannel(callback: (err: Error, confirmChannel: ConfirmChannel) => void): ConfirmChannel;
  createConfirmChannel(options: ChannelOptions, callback: (err: Error, confirmChannel: ConfirmChannel) => void): ConfirmChannel;
  updateSecret(newSecret: Buffer, reason: string, callback?: (err: Error) => void): void;

  on(event: 'connect', listener: (model: Connection) => void): this;
  on(event: 'disconnect', listener: (err: Error) => void): this;
  on(event: 'connect-failed', listener: (err: Error) => void): this;
  on(event: 'reconnect-scheduled', listener: (info: { attempt: number; delay: number; error: Error }) => void): this;
  on(event: 'reconnect-failed', listener: (err: Error) => void): this;
  on(event: 'blocked', listener: (reason: string) => void): this;
  on(event: 'unblocked', listener: () => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'update-secret-ok', listener: () => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

export declare function connect(callback: (err: Error, connection: Connection) => void): void;
export declare function connect(url: string | Options.Connect, callback: (err: Error, connection: Connection) => void): void;
export declare function connect(
  url: string | Options.Connect,
  socketOptions: SocketOptions,
  callback: (err: Error, connection: Connection) => void,
): void;
export declare function connect(
  url: string | Options.Connect,
  socketOptions: SocketOptions & { recovery: RecoveryOptions | true },
  callback: (err: Error, connection: RecoveringConnection) => void,
): RecoveringConnection;
