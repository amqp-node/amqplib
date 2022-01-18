declare module "@worthaboutapig/amqplib";

type CloseHandler = () => void;
type ErrorHandler = (error: Error) => void;
type IMessage = { content: string };

interface CommonChannelConnection {
  close(): Promise<void>;
  on(event: string, handler: CloseHandler | ErrorHandler): void;
  removeListener(name: string, handler: CloseHandler | ErrorHandler): void;
  valid: boolean;
}

interface IChannel extends CommonChannelConnection {
  handlers?: ChannelEventHandlers;
  assertQueue(name: string, options: unknown): Promise<void>;
  consume(name: string, handler: (message: IMessage) => Promise<void>, options: { noAck: boolean }): Promise<void>;
  sendToQueue(name: string, data: unknown, options: { persistent: true }): boolean;
}

interface IConnection extends CommonChannelConnection {
  handlers?: ConnectionEventHandlers;
  createChannel(): Promise<IChannel>;
}

type ConnectionEventHandlers = {
  onConnectionError(error: Error): Promise<void>;
  onConnectionClose(): Promise<void>;
};

type ChannelEventHandlers = {
  onChannelError(error: Error): Promise<void>;
  onChannelClose(): Promise<void>;
};
