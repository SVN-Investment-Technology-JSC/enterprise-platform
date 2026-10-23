export * from './lib/chat-launcher';
export { openChat, OPEN_CHAT_EVENT, type OpenChatDetail } from './lib/chat-context';
export * from './lib/user-avatar';
export { ensurePeople, setPersonAvatarVersion, usePeople, usePerson } from './lib/people-directory';
export { usePresence, lastSeenLabel } from './lib/presence';
export { chatApi, ChatApiError } from './lib/chat-api';
