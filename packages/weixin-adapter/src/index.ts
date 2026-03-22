export {
  DEFAULT_BASE_URL,
  DEFAULT_CDN_BASE_URL,
  FileWeixinAccountStore,
  createFileAccountStore,
} from "./auth/accounts.js";
export type {
  SaveWeixinAccountInput,
  WeixinAccountRecord,
} from "./auth/accounts.js";
export { normalizeAccountId } from "./auth/accounts.js";

export {
  buildBaseInfo,
  buildHeaders,
  getConfig,
  getUpdates,
  getUploadUrl,
  sendMessage,
  sendTyping,
} from "./api/api.js";
export type { WeixinApiOptions } from "./api/api.js";
export {
  MessageItemType,
  MessageState,
  MessageType,
  TypingStatus,
  UploadMediaType,
} from "./api/types.js";
export type {
  BaseInfo,
  GetBotQrCodeResp,
  GetConfigResp,
  GetQrCodeStatusResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  MessageItem,
  QrLoginStatus,
  SendMessageReq,
  SendTypingReq,
  WeixinMessage,
} from "./api/types.js";

export {
  fetchQrLoginConfig,
  getActiveQrLoginSession,
  startQrLogin,
  waitForQrLogin,
} from "./auth/login-qr.js";
export type {
  StartQrLoginOptions,
  WaitForQrLoginOptions,
  WeixinQrLoginResult,
  WeixinQrLoginSession,
} from "./auth/login-qr.js";

export {
  WeixinAdapterClient,
  createWeixinAdapterClient,
} from "./client/polling-client.js";
export type {
  CreateWeixinAdapterClientOptions,
  SendMediaOptions,
  SendTextOptions,
  StartPollingOptions,
  UploadLocalFileOptions,
  WeixinAdapterEvents,
  WeixinErrorEvent,
  WeixinRawEvent,
  WeixinStatusEvent,
} from "./client/polling-client.js";

export { TypedEventEmitter } from "./client/events.js";
export type { EventHandler } from "./client/events.js";

export { parseInboundMessage } from "./parser/inbound.js";
export type {
  WeixinInboundMedia,
  WeixinInboundMediaKind,
  WeixinInboundMessage,
} from "./parser/inbound.js";

export {
  downloadInboundMedia,
} from "./media/download.js";
export type { DownloadInboundMediaOptions } from "./media/download.js";
export {
  sendMedia,
  uploadLocalFile,
} from "./media/upload.js";
export type {
  UploadedWeixinMedia,
  WeixinSendMediaKind,
  WeixinSendMediaOptions,
  WeixinUploadLocalFileOptions,
} from "./media/upload.js";
export { transcodeVoiceIfNeeded } from "./media/transcode.js";
export type { TranscodeVoiceIfNeededOptions } from "./media/transcode.js";

export { createLogger } from "./utils/logger.js";
export type {
  WeixinAdapterLogger,
  WeixinAdapterLogLevel,
} from "./utils/logger.js";
