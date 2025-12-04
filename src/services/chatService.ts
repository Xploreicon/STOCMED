import type { Message, SearchResult } from '@/types/drug';
import { getMockAIResponse } from './mockChatAI';

export interface ChatResponse {
  message: string;
  searchResults?: SearchResult;
}

/**
 * Send a message to the chat service and get a response
 * @param userMessage - The message from the user
 * @param conversationHistory - Previous messages in the conversation
 * @returns Promise with the AI response and optional search results
 */
export async function sendMessage(
  userMessage: string,
  conversationHistory: Message[]
): Promise<ChatResponse> {
  try {
    // For now, use mock responses
    // TODO: Replace with Claude SDK when ready
    const { response, searchResults } = await getMockAIResponse(
      userMessage,
      conversationHistory
    );

    return {
      message: response,
      searchResults,
    };
  } catch (error) {
    console.error('Error sending message:', error);
    return {
      message: "I'm sorry, I'm having trouble processing your request right now. Please try again.",
    };
  }
}

/**
 * Validate user message before sending
 * @param message - The message to validate
 * @returns true if valid, false otherwise
 */
export function validateMessage(message: string): boolean {
  return message.trim().length > 0 && message.trim().length <= 1000;
}
