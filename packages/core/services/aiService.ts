/**
 * AI Service - Re-exports from modular implementation
 *
 * This file maintains backwards compatibility while the actual implementation
 * is split into smaller modules in ./ai/
 */

export { AIService, aiService } from './ai';
export type { ChatResponse, ConversationMessage, AppActions } from './ai';
