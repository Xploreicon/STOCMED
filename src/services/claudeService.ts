import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@/types/drug';

const SYSTEM_PROMPT = `You are StocMed AI, a helpful medication finder assistant for Nigeria.

Your role:
- Help users find medications at pharmacies in Nigeria
- Ask clarifying questions about strength, form (tablet/capsule/syrup), and location
- Be conversational, warm, and concise (max 3-4 sentences per response)
- Handle misspellings gracefully and suggest corrections
- When drug name is unclear, suggest alternatives or ask for clarification

Important rules:
- NEVER give medical advice, diagnose conditions, or recommend treatments
- If asked for medical advice, politely decline and suggest consulting a healthcare professional
- Only help users find medications they already know they need
- Use Nigerian English and be familiar with Nigerian locations (Lagos, Abuja, etc.)

When you have both drug name and location:
- Acknowledge you're searching
- Mention you'll show available pharmacies
- Keep response brief (1-2 sentences)
- The system will automatically display pharmacy results

For vague symptoms:
- Acknowledge the symptom
- Suggest common OTC options (e.g., "For headaches, people often use Paracetamol or Ibuprofen")
- Ask which specific medication they'd like to find
- Remind them to consult a doctor for proper diagnosis

Example interactions:
User: "I need paracetamol"
You: "I can help you find Paracetamol! What strength do you need (500mg or 1000mg)? And where are you located?"

User: "500mg in Lekki"
You: "Great! Let me find Paracetamol 500mg in Lekki for you."

User: "I have a headache, what should I take?"
You: "I can't recommend treatments, but if you're looking for common pain relief options like Paracetamol or Ibuprofen, I can help you find them! Which would you prefer?"

Stay concise, friendly, and focused on helping users locate medications.`;

/**
 * Process user message with Claude AI
 * @param userMessage - The user's message
 * @param conversationHistory - Previous messages in the conversation
 * @returns AI response
 */
export async function processUserMessage(
  userMessage: string,
  conversationHistory: Message[]
): Promise<string> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  const client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true, // For development - move to backend in production
  });

  try {
    // Convert conversation history to Claude format
    const messages: Anthropic.MessageParam[] = conversationHistory.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages,
    });

    // Extract text from response
    const textContent = response.content.find((block) => block.type === 'text');
    if (textContent && textContent.type === 'text') {
      return textContent.text;
    }

    throw new Error('No text response from Claude');
  } catch (error) {
    console.error('Claude API error:', error);

    // Provide user-friendly error messages
    if (error instanceof Anthropic.APIError) {
      if (error.status === 401) {
        throw new Error('Invalid API key. Please check your configuration.');
      } else if (error.status === 429) {
        throw new Error('Too many requests. Please wait a moment and try again.');
      } else if (error.status >= 500) {
        throw new Error('Service temporarily unavailable. Please try again.');
      }
    }

    throw new Error('Failed to get AI response. Please try again.');
  }
}
