import type { Message, SearchResult } from '@/types/drug';
import { processUserMessage } from './claudeService';
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
    // Try to use Claude API first
    const response = await processUserMessage(userMessage, conversationHistory);

    // Check if we should generate mock pharmacy results
    // This is a temporary solution until we have real pharmacy API
    const lowerMessage = userMessage.toLowerCase();
    const lowerResponse = response.toLowerCase();

    // If the response indicates we're searching or showing results,
    // generate mock data
    const shouldGenerateMockResults =
      (lowerResponse.includes('find') ||
        lowerResponse.includes('search') ||
        lowerResponse.includes('let me') ||
        lowerResponse.includes('showing')) &&
      (lowerMessage.includes('paracetamol') ||
        lowerMessage.includes('ibuprofen') ||
        lowerMessage.includes('amoxicillin') ||
        lowerMessage.includes('aspirin') ||
        lowerMessage.includes('metformin'));

    let searchResults: SearchResult | undefined;

    if (shouldGenerateMockResults) {
      // Use mock AI to generate pharmacy results
      const mockResponse = await getMockAIResponse(userMessage, conversationHistory);
      searchResults = mockResponse.searchResults;
    }

    return {
      message: response,
      searchResults,
    };
  } catch (error) {
    console.error('Error sending message:', error);

    // Fallback to mock AI if Claude API fails
    try {
      const { response, searchResults } = await getMockAIResponse(
        userMessage,
        conversationHistory
      );

      return {
        message: response,
        searchResults,
      };
    } catch (fallbackError) {
      console.error('Fallback error:', fallbackError);
      return {
        message: "I'm having trouble connecting right now. Please try again in a moment.",
      };
    }
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
