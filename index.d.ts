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

export interface Connection {
  readonly serverProperties: ServerProperties;
}

export interface ChannelModel extends events.EventEmitter {
  close(): Promise<void>;
  createChannel(options?: ChannelOptions): Promise<Channel>;
  createConfirmChannel(options?: ChannelOptions): Promise<ConfirmChannel>;
  readonly connection: Connection;
  updateSecret(newSecret: Buffer, reason: string): Promise<void>;

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

  close(): Promise<void>;

  assertQueue(queue?: string, options?: Options.AssertQueue): Promise<Replies.AssertQueue>;
  checkQueue(queue: string): Promise<Replies.AssertQueue>;

  deleteQueue(queue: string, options?: Options.DeleteQueue): Promise<Replies.DeleteQueue>;
  purgeQueue(queue: string): Promise<Replies.PurgeQueue>;

  bindQueue(queue: string, source: string, pattern: string, args?: any): Promise<Replies.Empty>;
  unbindQueue(queue: string, source: string, pattern: string, args?: any): Promise<Replies.Empty>;

  assertExchange(
    exchange: string,
    type: 'direct' | 'topic' | 'headers' | 'fanout' | 'match' | string,
    options?: Options.AssertExchange,
  ): Promise<Replies.AssertExchange>;
  checkExchange(exchange: string): Promise<Replies.Empty>;

  deleteExchange(exchange: string, options?: Options.DeleteExchange): Promise<Replies.Empty>;

  bindExchange(destination: string, source: string, pattern: string, args?: any): Promise<Replies.Empty>;
  unbindExchange(destination: string, source: string, pattern: string, args?: any): Promise<Replies.Empty>;

  publish(exchange: string, routingKey: string, content: Buffer, options?: Options.Publish): boolean;
  sendToQueue(queue: string, content: Buffer, options?: Options.Publish): boolean;

  consume(
    queue: string,
    onMessage: (msg: ConsumeMessage | null) => void,
    options?: Options.Consume,
  ): Promise<Replies.Consume>;

  cancel(consumerTag: string): Promise<Replies.Empty>;
  get(queue: string, options?: Options.Get): Promise<GetMessage | false>;

  ack(message: Message, allUpTo?: boolean): void;
  ackAll(): void;

  nack(message: Message, allUpTo?: boolean, requeue?: boolean): void;
  nackAll(requeue?: boolean): void;
  reject(message: Message, requeue?: boolean): void;

  prefetch(count: number, global?: boolean): Promise<Replies.Empty>;
  recover(): Promise<Replies.Empty>;
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

  waitForConfirms(): Promise<void>;
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
  setup?: ((model: ChannelModel) => Promise<void>) | ((model: ChannelModel, done: (err?: Error) => void) => void);
}

export interface RecoveringChannelModel extends events.EventEmitter {
  close(): Promise<void>;
  createChannel(options?: ChannelOptions): Promise<Channel>;
  createConfirmChannel(options?: ChannelOptions): Promise<ConfirmChannel>;
  updateSecret(newSecret: Buffer, reason: string): Promise<void>;

  on(event: 'connect', listener: (model: ChannelModel) => void): this;
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

export declare function connect(url: string | Options.Connect, socketOptions: SocketOptions & { recovery: RecoveryOptions | true }): Promise<RecoveringChannelModel>;
export declare function connect(url: string | Options.Connect, socketOptions?: SocketOptions): Promise<ChannelModel>;
